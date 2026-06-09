/// <reference lib="dom" />
import type { Page } from "playwright-core";
import type {
  AdapterContext,
  CarrierAdapter,
  PolicyInput,
  ScrapeResult,
} from "../types";

const LOGIN_URL = "https://apps.b2b.statefarm.com/login";
const SEARCH_URL =
  "https://apps.b2b.statefarm.com/b2b/InsuranceInquiry/policySearch";
const SEARCH_URL_FRAGMENT = "InsuranceInquiry/policySearch";
const LOGIN_URL_FRAGMENT = "/login";
// Hosts/paths that mean the session is NOT established. An unauthenticated (or
// expired) request to the search page is bounced through State Farm's CIAM
// single sign-on (Azure Entra External ID) at *.ciamlogin.com — the "Pick an
// account" screen — which contains neither "/login" nor the search fragment, so
// it must be detected explicitly.
const AUTH_URL_FRAGMENTS = [
  "ciamlogin.com",
  "login.microsoftonline.com",
  "/oauth2/",
  "/authorize",
  LOGIN_URL_FRAGMENT,
];

function isAuthRedirectUrl(url: string): boolean {
  if (url.includes(SEARCH_URL_FRAGMENT)) return false;
  return AUTH_URL_FRAGMENTS.some((frag) => url.includes(frag));
}

const STEP_TIMEOUT_MS = 25_000;

type StateFarmScraped = {
  policyNumber?: string;
  policyStatus?: string;
  policyOriginDate?: string;
  policyEffectiveDate?: string;
  hasCollision?: boolean;
  collisionDeductible?: string;
  hasComprehensive?: boolean;
  comprehensiveDeductible?: string;
  bodilyInjuryLimitPerAccident?: string;
  propertyDamageLimitPerAccident?: string;
  lienholderName?: string;
  lienholderAddress?: string;
  lossPaye?: string;
};

type PageState =
  | "search"
  | "auto-selection"
  | "policy-info"
  | "no-results"
  | "unknown";

async function probeState(page: Page): Promise<PageState> {
  return page.evaluate((searchFragment) => {
    const url = location.href;
    const body = document.body?.innerText ?? "";
    if (url.includes(searchFragment) && document.querySelector("#vinID")) {
      return "search" as const;
    }
    if (
      /Auto\s+Selection/i.test(body) &&
      document.querySelectorAll('input[type="radio"]').length > 0
    ) {
      return "auto-selection" as const;
    }
    if (/Policy\s+(Origin|Effective)\s+Date/i.test(body)) {
      return "policy-info" as const;
    }
    if (
      /no\s+(results|records|polic(?:y|ies))|not\s+found|unable\s+to\s+locate/i.test(
        body,
      )
    ) {
      return "no-results" as const;
    }
    return "unknown" as const;
  }, SEARCH_URL_FRAGMENT);
}

/**
 * Poll {@link probeState} until the page settles on a meaningful state.
 *
 * Clicking the search/Continue buttons triggers a navigation, but
 * `waitForLoadState("domcontentloaded")` resolves immediately because the
 * *previous* document is already loaded — so a naive single probe reads the
 * stale page (observed: post-Continue re-probe ran 17ms after the click and
 * still saw the Auto Selection page). This waits until the state is no longer
 * "unknown" and (optionally) no longer a stale `away` state.
 */
async function waitForPageState(
  page: Page,
  opts: { away?: PageState } = {},
): Promise<PageState> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  // probeState runs a page.evaluate; if a navigation is in flight (e.g. right
  // after clicking Continue) the execution context is destroyed and evaluate
  // throws. Treat that as a transient "unknown" and keep polling.
  const safeProbe = async (): Promise<PageState> => {
    try {
      return await probeState(page);
    } catch {
      return "unknown";
    }
  };
  let state = await safeProbe();
  while (Date.now() < deadline) {
    if (state !== "unknown" && state !== opts.away) return state;
    await page.waitForTimeout(400);
    state = await safeProbe();
  }
  return state;
}

async function ensureOnSearch(page: Page): Promise<boolean> {
  // The Insurance Inquiry tool runs on a session-scoped host (lenders.apps.*
  // with a per-session _cid token) that the user navigates to manually, so we
  // never force-navigate to a hardcoded URL. We only confirm the current tab
  // is the search page and has the VIN field ready.
  const url = page.url();
  if (isAuthRedirectUrl(url)) {
    return false;
  }
  try {
    await page.waitForSelector("#vinID", { timeout: STEP_TIMEOUT_MS });
  } catch {
    return false;
  }
  return true;
}

async function fillAndSubmit(page: Page, vin: string): Promise<void> {
  await page.evaluate((vinValue) => {
    const el = document.querySelector<HTMLInputElement>("#vinID");
    if (!el) throw new Error("#vinID not found");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    if (setter) setter.call(el, vinValue);
    else el.value = vinValue;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, vin);

  const search = await page.$("#atpSearchButtonID");
  if (!search) throw new Error("Search button #atpSearchButtonID not found");
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: STEP_TIMEOUT_MS }),
    search.click(),
  ]);
}

type AutoSelectionResult =
  | { ok: true; pickedBy: string; rowText: string }
  | {
      ok: false;
      error: string;
      choices?: Array<{ id: string; label: string }>;
    };

async function pickAutoSelection(
  page: Page,
  policy: PolicyInput,
): Promise<{ picked: string; rowText: string }> {
  const result = (await page.evaluate(
    ({ lastName, policyNumber }) => {
      // The Auto Selection page lists candidate policies each with its own
      // radio. The radios aren't necessarily inside <tr> elements, so build
      // the candidate list from the radios themselves and derive each radio's
      // "row" by walking up to the nearest row-like ancestor (tr, [role=row],
      // li, or a labelled container) for text matching.
      function rowTextFor(radio: HTMLInputElement): string {
        // Prefer an associated <label>.
        let labelText = "";
        if (radio.id) {
          const lbl = document.querySelector(
            `label[for="${CSS.escape(radio.id)}"]`,
          ) as HTMLElement | null;
          if (lbl) labelText = lbl.innerText || lbl.textContent || "";
        }
        const ancestor = radio.closest(
          'tr, [role="row"], li, fieldset, .row, [class*="row"]',
        ) as HTMLElement | null;
        const ancestorText = ancestor
          ? ancestor.innerText || ancestor.textContent || ""
          : (radio.parentElement?.innerText ??
             radio.parentElement?.textContent ??
             "");
        return `${labelText} ${ancestorText}`.replace(/\s+/g, " ").trim();
      }

      const radios = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ).filter((r) => !r.disabled);
      const rows = radios.map((radio) => ({ radio, text: rowTextFor(radio) }));

      if (rows.length === 0) {
        // Surface a small DOM hint so we can adjust selectors if needed.
        const radioCount = document.querySelectorAll(
          'input[type="radio"]',
        ).length;
        const bodySnippet = (document.body?.innerText ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300);
        return {
          ok: false,
          error: `No selectable rows on Auto Selection (radios=${radioCount}) — ${bodySnippet}`,
        };
      }
      let target: { radio: HTMLInputElement; text: string } | null = null;
      let pickedBy = "last-row";
      if (policyNumber) {
        const digits = String(policyNumber).replace(/\D/g, "");
        if (digits) {
          // Exact policy-number match wins; scan from the bottom so the most
          // recent (active) row is preferred on ties.
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].text.replace(/\D/g, "").includes(digits)) {
              target = rows[i];
              break;
            }
          }
          if (target) pickedBy = "policy-number";
        }
      }
      if (!target && lastName) {
        const lower = String(lastName).trim().toLowerCase();
        const matches = rows.filter((row) =>
          row.text.toLowerCase().includes(lower),
        );
        if (matches.length >= 1) {
          // State Farm lists the active policy last (the prior/inactive policy
          // appears above it), so when several rows match the borrower we take
          // the bottom-most match.
          target = matches[matches.length - 1];
          pickedBy = "last-name";
        }
      }
      if (!target) {
        // No usable match signal — default to the bottom row, which on the
        // State Farm Auto Selection page is the active policy.
        target = rows[rows.length - 1];
        pickedBy = "last-row";
      }
      const radio = target.radio;
      if (!radio) return { ok: false, error: "Row has no radio button" };
      radio.click();
      const continueBtn = Array.from(
        document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
          'button, input[type="submit"], input[type="button"]',
        ),
      ).find((b) => {
        const t =
          "innerText" in b ? b.innerText : (b as HTMLInputElement).value;
        return /^continue$/i.test((t ?? "").trim());
      });
      if (!continueBtn) {
        return { ok: false, error: "Continue button not found" };
      }
      continueBtn.click();
      return {
        ok: true,
        pickedBy,
        rowText: target.text,
      };
    },
    { lastName: policy.borrowerLastName, policyNumber: policy.policyNumber ?? "" },
  )) as AutoSelectionResult;

  if (!result.ok) {
    const err = new Error(result.error) as Error & {
      ambiguousChoices?: Array<{ id: string; label: string }>;
    };
    err.ambiguousChoices = result.choices;
    throw err;
  }

  await page.waitForLoadState("domcontentloaded", { timeout: STEP_TIMEOUT_MS });
  return { picked: result.pickedBy, rowText: result.rowText };
}

async function scrapePolicyInfo(page: Page): Promise<StateFarmScraped> {
  return (await page.evaluate(() => {
    function getTextAfterLabel(labelRegex: RegExp): string | undefined {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const el = node as HTMLElement;
        const txt = (el.innerText || el.textContent || "").trim();
        if (!txt) continue;
        if (labelRegex.test(txt) && txt.length < 200) {
          const inlineMatch = txt.match(labelRegex);
          if (inlineMatch && inlineMatch.index === 0) {
            const after = txt
              .slice(inlineMatch[0].length)
              .replace(/^[:\s]+/, "")
              .trim();
            if (after) return after;
          }
          let sib = el.nextElementSibling as HTMLElement | null;
          while (sib) {
            const sibTxt = (sib.innerText || sib.textContent || "").trim();
            if (sibTxt) return sibTxt;
            sib = sib.nextElementSibling as HTMLElement | null;
          }
          const parentSib = (el.parentElement?.nextElementSibling ??
            null) as HTMLElement | null;
          const parentTxt = (
            parentSib?.innerText ||
            parentSib?.textContent ||
            ""
          ).trim();
          if (parentTxt) return parentTxt;
        }
      }
      return undefined;
    }
    function bodyText(): string {
      return document.body?.innerText ?? "";
    }
    function scrapeCoverageBlock(letter: string, name: string) {
      const text = bodyText();
      const lines = text.split(/\n+/).map((l) => l.trim());
      const idx = lines.findIndex(
        (l) =>
          new RegExp(`^${letter}\\b.*${name}`, "i").test(l) ||
          new RegExp(`\\b${name}\\b`, "i").test(l),
      );
      if (idx === -1) return { present: false, deductible: undefined };
      const win = lines.slice(idx, idx + 5).join(" ");
      const m =
        win.match(/(?:Deductible|Ded)[^\d$]*\$?\s*([0-9][\d,]*)/i) ??
        win.match(/\$\s*([0-9][\d,]*)/);
      const deductible = m ? m[1].replace(/,/g, "") : undefined;
      return { present: true, deductible };
    }

    const result: Record<string, unknown> = {
      policyNumber: getTextAfterLabel(/^Policy\s+Number\b/i),
      policyStatus: getTextAfterLabel(/^Policy\s+Status\b/i),
      policyOriginDate: getTextAfterLabel(/^Policy\s+Origin\s+Date\b/i),
      policyEffectiveDate: getTextAfterLabel(/^Policy\s+Effective\s+Date\b/i),
      lienholderName:
        getTextAfterLabel(/^Lien\s*holder\b/i) ??
        getTextAfterLabel(/^Lienholder\s+Name\b/i),
      lienholderAddress: getTextAfterLabel(/^Lien\s*holder\s+Address\b/i),
      lossPaye: getTextAfterLabel(/^Loss\s*Pay(ee|e)\b/i),
    };
    const collision = scrapeCoverageBlock("A", "Collision");
    result.hasCollision = collision.present;
    if (collision.deductible) result.collisionDeductible = collision.deductible;
    const comprehensive = scrapeCoverageBlock("D", "Comprehensive");
    result.hasComprehensive = comprehensive.present;
    if (comprehensive.deductible)
      result.comprehensiveDeductible = comprehensive.deductible;
    const txt = bodyText();
    const biMatch = txt.match(
      /Bodily\s+Injury[^$\n]*\$?\s*([0-9][\d,]*)\s*\/\s*\$?\s*([0-9][\d,]*)/i,
    );
    if (biMatch) result.bodilyInjuryLimitPerAccident = biMatch[2].replace(/,/g, "");
    const pdMatch = txt.match(/Property\s+Damage[^$\n]*\$?\s*([0-9][\d,]*)/i);
    if (pdMatch) result.propertyDamageLimitPerAccident = pdMatch[1].replace(/,/g, "");
    return result;
  })) as StateFarmScraped;
}

async function navigateBackToSearch(page: Page): Promise<void> {
  // Return to the search form via in-session navigation so we keep the
  // user's session-scoped host + _cid token (a hardcoded goto would drop it).
  try {
    await page.goBack({
      waitUntil: "domcontentloaded",
      timeout: STEP_TIMEOUT_MS,
    });
  } catch {
    // not fatal — next iteration re-checks page state
  }
}

export const stateFarmAdapter: CarrierAdapter = {
  id: "state-farm",
  name: "State Farm B2B",
  ready: true,
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,
  searchPageFragment: SEARCH_URL_FRAGMENT,

  async isLoggedIn(page: Page): Promise<boolean> {
    // Read-only: never navigate. The monitor passes a tab the user already has
    // open on a State Farm host. We're logged in if that tab is either the
    // Insurance Inquiry search tool (#vinID present) or the authenticated B2B
    // portal (a "Log out" control is present), and is not sitting on the
    // CIAM / Entra single sign-on ("Pick an account") screen.
    let url = "";
    try {
      url = page.url();
    } catch {
      return false;
    }
    if (isAuthRedirectUrl(url)) return false;
    try {
      return await page.evaluate(() => {
        if (document.querySelector("#vinID")) return true;
        const text = document.body?.innerText ?? "";
        return /\blog\s?out\b/i.test(text);
      });
    } catch {
      return false;
    }
  },

  async verifyVin(
    page: Page,
    policy: PolicyInput,
    ctx: AdapterContext,
  ): Promise<ScrapeResult> {
    try {
      const onSearch = await ensureOnSearch(page);
      if (!onSearch) {
        ctx.log(
          "Not on the State Farm Insurance Inquiry search page (expected #vinID). " +
            "Open the Insurance Inquiry tool tab (Home & Auto Lenders \u2192 Insurance " +
            "Inquiry \u2192 Insurance Inquiry Tool) before starting the sweep.",
        );
        return { status: "error", reason: "Not on State Farm search page" };
      }
      await ctx.screenshot("01-search");

      await fillAndSubmit(page, policy.vin);
      await ctx.screenshot("02-after-submit");

      let state = await waitForPageState(page);
      ctx.log("post-submit state", { state });

      if (state === "auto-selection") {
        try {
          const picked = await pickAutoSelection(page, policy);
          ctx.log("auto-selection picked", picked);
        } catch (err) {
          const e = err as Error & {
            ambiguousChoices?: Array<{ id: string; label: string }>;
          };
          if (e.ambiguousChoices && e.ambiguousChoices.length > 0) {
            await ctx.screenshot("03-ambiguous-auto-selection");
            const reviewId = await ctx.requestHumanReview(
              `State Farm Auto Selection page has multiple matches for last name "${policy.borrowerLastName}". Pick the correct row.`,
              e.ambiguousChoices,
            );
            return { status: "needs-review", reviewId };
          }
          throw err;
        }
        // Continue triggers a navigation to the Policy Information page; wait
        // until the page leaves the (now stale) Auto Selection state.
        state = await waitForPageState(page, { away: "auto-selection" });
        ctx.log("post-auto-selection state", { state });
        await ctx.screenshot("03-after-auto-selection");
      }

      if (state === "no-results") {
        await ctx.screenshot("04-no-results");
        await navigateBackToSearch(page);
        return { status: "not-found" };
      }

      if (state !== "policy-info") {
        await ctx.screenshot("04-unknown-state");
        await navigateBackToSearch(page);
        return {
          status: "error",
          reason: `Unexpected page state after search: ${state}`,
        };
      }

      await ctx.screenshot("04-policy-info");
      const scraped = await scrapePolicyInfo(page);
      ctx.log("scraped policy", scraped);
      await navigateBackToSearch(page);

      return {
        status: "found",
        data: {
          policyNumber: scraped.policyNumber,
          coverages: scraped as unknown as Record<
            string,
            string | number | boolean
          >,
          raw: scraped as unknown as Record<string, unknown>,
        },
      };
    } catch (err) {
      ctx.log("verifyVin error", { error: String(err) });
      try {
        await ctx.screenshot("99-error");
      } catch {
        // ignore
      }
      try {
        await navigateBackToSearch(page);
      } catch {
        // ignore
      }
      return {
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
