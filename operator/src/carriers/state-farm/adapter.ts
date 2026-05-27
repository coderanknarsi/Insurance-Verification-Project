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

async function ensureOnSearch(page: Page): Promise<boolean> {
  const url = page.url();
  if (!url.includes(SEARCH_URL_FRAGMENT)) {
    try {
      await page.goto(SEARCH_URL, {
        waitUntil: "domcontentloaded",
        timeout: STEP_TIMEOUT_MS,
      });
    } catch {
      return false;
    }
  }
  if (page.url().includes(LOGIN_URL_FRAGMENT)) return false;
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
      const rows = Array.from(document.querySelectorAll("tr")).filter((tr) =>
        tr.querySelector('input[type="radio"]'),
      );
      if (rows.length === 0) {
        return { ok: false, error: "No selectable rows on Auto Selection" };
      }
      let target: Element | null = null;
      let pickedBy = "first";
      if (policyNumber) {
        const digits = String(policyNumber).replace(/\D/g, "");
        if (digits) {
          target =
            rows.find((tr) =>
              ((tr as HTMLElement).innerText || "")
                .replace(/\D/g, "")
                .includes(digits),
            ) ?? null;
          if (target) pickedBy = "policy-number";
        }
      }
      if (!target && lastName) {
        const lower = String(lastName).trim().toLowerCase();
        const matches = rows.filter((tr) =>
          ((tr as HTMLElement).innerText || "").toLowerCase().includes(lower),
        );
        if (matches.length === 1) {
          target = matches[0];
          pickedBy = "last-name";
        } else if (matches.length > 1) {
          return {
            ok: false,
            error: "ambiguous",
            choices: matches.map((tr, i) => ({
              id: String(i),
              label: ((tr as HTMLElement).innerText || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 140),
            })),
          };
        }
      }
      if (!target) {
        target = rows[0];
        pickedBy = "first";
      }
      const radio = target.querySelector<HTMLInputElement>(
        'input[type="radio"]',
      );
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
        rowText: ((target as HTMLElement).innerText || "")
          .replace(/\s+/g, " ")
          .trim(),
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
  try {
    await page.goto(SEARCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: STEP_TIMEOUT_MS,
    });
  } catch {
    // not fatal — next iteration will reset
  }
}

export const stateFarmAdapter: CarrierAdapter = {
  id: "state-farm",
  name: "State Farm B2B",
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      await page.goto(SEARCH_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
    } catch {
      return false;
    }
    const url = page.url();
    if (url.includes(LOGIN_URL_FRAGMENT) && !url.includes(SEARCH_URL_FRAGMENT)) {
      return false;
    }
    if (url.includes(SEARCH_URL_FRAGMENT)) return true;
    try {
      const vinInput = await page.$('input[name="vin"], #vinID');
      return Boolean(vinInput);
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
        ctx.log("Not authenticated to State Farm portal");
        return { status: "error", reason: "Not logged in to State Farm" };
      }
      await ctx.screenshot("01-search");

      await fillAndSubmit(page, policy.vin);
      await ctx.screenshot("02-after-submit");

      let state = await probeState(page);
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
        await ctx.screenshot("03-after-auto-selection");
        state = await probeState(page);
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
