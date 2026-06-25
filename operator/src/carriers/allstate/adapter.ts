/// <reference lib="dom" />
import type { Page } from "playwright-core";
import type {
  AdapterContext,
  CarrierAdapter,
  PolicyInput,
  ScrapeResult,
} from "../types";

/**
 * Allstate AXCiS Lender Portal adapter.
 *
 * AXCiS is a classic ASP.NET WebForms (.aspx) site, so — like State Farm — we
 * drive it by DOM interaction + scraping rather than a JSON API. The operator
 * logs in (User ID/Password + emailed OTP) by hand; this adapter only runs once
 * the authenticated "Lienholder Service Center" search page is reachable, then
 * fills the policy#/VIN search and scrapes the coverage response table.
 *
 * Flow (captured 2026-06-25):
 *   Login    : https://eaxcis.allstate.com/Anon/Login/Login.aspx
 *   MFA      : https://conacc.allstate.com/mga/sps/authsvc?TransactionId=… (human handles)
 *   Welcome  : conacc.allstate.com …/Welcome.aspx ("Click on Lienholder to enter")
 *   Search   : https://eaxcis.allstate.com/Secured/auto/request.aspx
 *   Response : https://eaxcis.allstate.com/Secured/auto/Response.aspx
 *
 * The search form offers two paths; we drive the primary one:
 *   Automobile Policy number + Last five (5) digits of VIN → "Lookup"
 */

const LOGIN_URL = "https://eaxcis.allstate.com/Anon/Login/Login.aspx";
const SEARCH_URL = "https://eaxcis.allstate.com/Secured/auto/request.aspx";
const SEARCH_URL_FRAGMENT = "Secured/auto/request.aspx";
const RESPONSE_URL_FRAGMENT = "Secured/auto/Response.aspx";

// Hosts/paths that mean the session is NOT established. Unauthenticated requests
// land on the Anon area (login/landing) or are bounced to Allstate's CIAM auth
// service on conacc.allstate.com (the "Verification Required" OTP screen).
const AUTH_URL_FRAGMENTS = [
  "/Anon/Login",
  "/Anon/Default",
  "ciamlogin",
  "/authsvc",
  "/oauth2/",
  "/authorize",
];

const STEP_TIMEOUT_MS = 25_000;

function isAuthRedirectUrl(url: string): boolean {
  if (url.includes(SEARCH_URL_FRAGMENT) || url.includes(RESPONSE_URL_FRAGMENT)) {
    return false;
  }
  return AUTH_URL_FRAGMENTS.some((frag) => url.includes(frag));
}

/** Raw scraped fields the backend Allstate normalizer consumes (all optional). */
type AllstateScraped = {
  policyNumber?: string;
  insuredName?: string;
  companyName?: string;
  policyEffectiveDate?: string;
  policyExpirationDate?: string;
  policyStatus?: string;
  vin?: string;
  modelName?: string;
  modelYear?: string;
  bodilyInjuryLimit?: string;
  propertyDamageLimit?: string;
  hasCollision?: boolean;
  collisionDeductible?: string;
  hasComprehensive?: boolean;
  comprehensiveDeductible?: string;
  cancelDate?: string;
  reinstateDate?: string;
  lienholderName?: string;
  lienholderAddress?: string;
  lienholderCityStateZip?: string;
  loanExpiration?: string;
  vehicleAdded?: string;
};

type PageState = "search" | "response" | "no-results" | "unknown";

/**
 * Probe the current page to classify it. Runs in the page context. The search
 * page has the "Automobile Policy number" label + a Lookup button; the response
 * page renders the coverage table containing "Policy Status" + deductibles.
 */
async function probeState(page: Page): Promise<PageState> {
  return page.evaluate(() => {
    const body = (document.body?.innerText ?? "").replace(/\s+/g, " ");
    const hasLookup = !!Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="submit"], input[type="button"], button',
      ),
    ).find((b) => /^lookup$/i.test((b.value || b.textContent || "").trim()));

    if (/Automobile Policy number/i.test(body) && hasLookup) {
      return "search" as const;
    }
    if (/Policy Status/i.test(body) && /Comprehensive Deductible/i.test(body)) {
      return "response" as const;
    }
    if (
      /no\s+(records?|polic(?:y|ies)|match)|not\s+found|invalid|unable\s+to\s+locate|no\s+results/i.test(
        body,
      )
    ) {
      return "no-results" as const;
    }
    return "unknown" as const;
  });
}

/**
 * Poll {@link probeState} until the page settles. An ASP.NET postback navigates
 * the whole document, but `waitForLoadState("domcontentloaded")` can resolve
 * against the stale page, so we re-probe until the state is meaningful (and, if
 * given, no longer the stale `away` state). Navigations destroy the evaluate
 * context transiently — treat that as "unknown" and keep polling.
 */
async function waitForPageState(
  page: Page,
  opts: { away?: PageState } = {},
): Promise<PageState> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
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

/**
 * Ensure we're on the AXCiS search page. The secured area uses standard session
 * cookies on eaxcis.allstate.com, so a same-session navigation to the stable
 * request.aspx URL is safe. Returns false if we get bounced to an auth screen
 * (operator needs to log in / complete OTP first).
 */
async function ensureOnSearch(page: Page): Promise<boolean> {
  let url = "";
  try {
    url = page.url();
  } catch {
    return false;
  }
  if (isAuthRedirectUrl(url)) return false;

  if (!url.includes(SEARCH_URL_FRAGMENT)) {
    try {
      await page.goto(SEARCH_URL, {
        waitUntil: "domcontentloaded",
        timeout: STEP_TIMEOUT_MS,
      });
    } catch {
      return false;
    }
    if (isAuthRedirectUrl(page.url())) return false;
  }

  const state = await waitForPageState(page);
  return state === "search";
}

/**
 * Fill the policy number + last-5-of-VIN fields and click Lookup. Fields are
 * located by their visible label text (AXCiS uses opaque ASP.NET control ids),
 * so we walk from each label cell to the input in its row.
 */
async function fillAndSubmit(
  page: Page,
  policyNumber: string,
  lastFiveVin: string,
): Promise<{ ok: boolean; error?: string }> {
  const filled = await page.evaluate(
    ({ policyNumber, lastFiveVin }) => {
      function setValue(input: HTMLInputElement, value: string): void {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        if (setter) setter.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      function findInputByLabel(labelRe: RegExp): HTMLInputElement | null {
        const labels = Array.from(
          document.querySelectorAll<HTMLElement>("td, th, label, span, div"),
        );
        for (const el of labels) {
          const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!txt || txt.length > 60 || !labelRe.test(txt)) continue;
          // 1) An input inside the same row as the label cell.
          const row = el.closest("tr");
          if (row) {
            const inputs = Array.from(
              row.querySelectorAll<HTMLInputElement>(
                'input[type="text"], input:not([type]), input[type="password"]',
              ),
            );
            if (inputs.length > 0) return inputs[0];
          }
          // 2) Next sibling cell's input.
          let sib = el.nextElementSibling as HTMLElement | null;
          while (sib) {
            const inp = sib.matches?.("input")
              ? (sib as unknown as HTMLInputElement)
              : sib.querySelector<HTMLInputElement>(
                  'input[type="text"], input:not([type])',
                );
            if (inp) return inp;
            sib = sib.nextElementSibling as HTMLElement | null;
          }
        }
        return null;
      }

      const policyInput = findInputByLabel(/Automobile Policy number/i);
      const vinInput = findInputByLabel(/digits of VIN/i);
      if (!policyInput) return { ok: false, error: "Policy number field not found" };
      if (!vinInput) return { ok: false, error: "Last-5-VIN field not found" };
      setValue(policyInput, policyNumber);
      setValue(vinInput, lastFiveVin);

      const lookup = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input[type="submit"], input[type="button"], button',
        ),
      ).find((b) => /^lookup$/i.test((b.value || b.textContent || "").trim()));
      if (!lookup) return { ok: false, error: "Lookup button not found" };
      // Tag the button so the Node side can click it and await navigation.
      lookup.setAttribute("data-autolien-lookup", "1");
      return { ok: true };
    },
    { policyNumber, lastFiveVin },
  );

  if (!filled.ok) return filled;

  const lookup = await page.$('[data-autolien-lookup="1"]');
  if (!lookup) return { ok: false, error: "Lookup button vanished before click" };
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: STEP_TIMEOUT_MS }),
    lookup.click(),
  ]);
  return { ok: true };
}

/** Scrape the AXCiS coverage response table by label-anchored cell traversal. */
async function scrapeResponse(page: Page): Promise<AllstateScraped> {
  return (await page.evaluate(() => {
    function clean(s: string): string {
      return s.replace(/\s+/g, " ").trim();
    }
    /** Value of the cell following the label cell whose text matches labelRe. */
    function valueFor(labelRe: RegExp): string | undefined {
      const cells = Array.from(
        document.querySelectorAll<HTMLElement>("td, th"),
      );
      for (const cell of cells) {
        const label = clean(cell.textContent ?? "").replace(/:\s*$/, "");
        if (!label || label.length > 40 || !labelRe.test(label)) continue;
        let sib = cell.nextElementSibling as HTMLElement | null;
        while (sib) {
          const inp = sib.querySelector<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          >("input, select, textarea");
          const raw = inp ? inp.value ?? "" : (sib.textContent ?? "");
          const val = clean(raw);
          if (val) return val;
          sib = sib.nextElementSibling as HTMLElement | null;
        }
      }
      return undefined;
    }
    function emptyish(v: string | undefined): string | undefined {
      if (v === undefined) return undefined;
      const t = v.trim();
      if (!t || /^n\/?a$/i.test(t)) return undefined;
      return t;
    }

    const result: Record<string, string | boolean | undefined> = {};
    result.policyNumber = emptyish(valueFor(/^Policy Number$/i));
    result.insuredName = emptyish(valueFor(/^Name of Insured$/i));
    result.companyName = emptyish(valueFor(/^Company Name$/i));
    result.policyStatus = emptyish(valueFor(/^Policy Status$/i));
    result.vin = emptyish(valueFor(/^Vin Number$/i));
    result.modelName = emptyish(valueFor(/^Model Name$/i));
    result.modelYear = emptyish(valueFor(/^Model Year$/i));
    result.bodilyInjuryLimit = emptyish(valueFor(/BI.*Liability/i));
    result.propertyDamageLimit = emptyish(valueFor(/^PD.*Liability/i));
    result.cancelDate = emptyish(valueFor(/^Cancel Date$/i));
    result.reinstateDate = emptyish(valueFor(/^Reinstate Date$/i));
    result.lienholderName = emptyish(valueFor(/^LPC Listed$/i));
    result.lienholderAddress = emptyish(valueFor(/^LPC Address$/i));
    result.lienholderCityStateZip = emptyish(valueFor(/^LPC City/i));
    result.loanExpiration = emptyish(valueFor(/^Loan Expiration$/i));
    result.vehicleAdded = emptyish(valueFor(/^Vehicle Added$/i));

    const period = emptyish(valueFor(/^Policy Period$/i));
    if (period) {
      const parts = period.split(/\s[-–]\s/);
      if (parts[0]) result.policyEffectiveDate = parts[0].trim();
      if (parts[1]) result.policyExpirationDate = parts[1].trim();
    }

    const collision = emptyish(valueFor(/^Collision Deductible$/i));
    if (collision) {
      result.hasCollision = true;
      result.collisionDeductible = collision;
    }
    const comprehensive = emptyish(valueFor(/^Comprehensive Deductible$/i));
    if (comprehensive) {
      result.hasComprehensive = true;
      result.comprehensiveDeductible = comprehensive;
    }

    return result;
  })) as AllstateScraped;
}

async function navigateBackToSearch(page: Page): Promise<void> {
  try {
    await page.goto(SEARCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: STEP_TIMEOUT_MS,
    });
  } catch {
    // not fatal — next iteration re-checks page state
  }
}

export const allstateAdapter: CarrierAdapter = {
  id: "allstate",
  name: "Allstate AXCiS",
  ready: true,
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,
  searchPageFragment: SEARCH_URL_FRAGMENT,

  async isLoggedIn(page: Page): Promise<boolean> {
    // Read-only: never navigate. Logged in if the tab is anywhere in the
    // authenticated AXCiS secured area (search/response) or the conacc Welcome
    // landing, and not sitting on an Anon/login or CIAM OTP screen.
    let url = "";
    try {
      url = page.url();
    } catch {
      return false;
    }
    if (isAuthRedirectUrl(url)) return false;
    if (
      url.includes(SEARCH_URL_FRAGMENT) ||
      url.includes(RESPONSE_URL_FRAGMENT) ||
      /eaxcis\.allstate\.com\/Secured\//i.test(url)
    ) {
      return true;
    }
    // conacc Welcome.aspx after OTP — authenticated but not yet at the search
    // tool. Treat as logged in; verifyVin navigates to the search page.
    if (/conacc\.allstate\.com/i.test(url) && /Welcome\.aspx/i.test(url)) {
      return true;
    }
    return false;
  },

  async verifyVin(
    page: Page,
    policy: PolicyInput,
    ctx: AdapterContext,
  ): Promise<ScrapeResult> {
    try {
      const policyNumber = (policy.policyNumber ?? "").trim();
      if (!policyNumber) {
        ctx.log(
          "Allstate lookup requires a policy number (policy# + last 5 of VIN). " +
            "No policyNumber on this record.",
        );
        return {
          status: "error",
          reason: "Allstate requires a policy number to search",
        };
      }
      const lastFiveVin = policy.vin.replace(/\s/g, "").slice(-5);
      if (lastFiveVin.length < 5) {
        return { status: "error", reason: "VIN too short for last-5 lookup" };
      }

      const onSearch = await ensureOnSearch(page);
      if (!onSearch) {
        ctx.log(
          "Not on the Allstate AXCiS search page. Log in (User ID/Password + " +
            "emailed code), click 'Lienholder to enter', and leave the " +
            "Lienholder Service Center search page open before starting the sweep.",
        );
        return { status: "error", reason: "Not on Allstate AXCiS search page" };
      }
      await ctx.screenshot("01-search");

      const submit = await fillAndSubmit(page, policyNumber, lastFiveVin);
      if (!submit.ok) {
        await ctx.screenshot("02-fill-failed");
        return { status: "error", reason: submit.error ?? "Search fill failed" };
      }
      await ctx.screenshot("02-after-submit");

      const state = await waitForPageState(page, { away: "search" });
      ctx.log("post-submit state", { state });

      if (state === "no-results") {
        await ctx.screenshot("03-no-results");
        await navigateBackToSearch(page);
        return { status: "not-found" };
      }

      if (state !== "response") {
        await ctx.screenshot("03-unknown-state");
        await navigateBackToSearch(page);
        return {
          status: "error",
          reason: `Unexpected page state after lookup: ${state}`,
        };
      }

      await ctx.screenshot("03-response");
      const scraped = await scrapeResponse(page);
      ctx.log("scraped policy", scraped);
      await navigateBackToSearch(page);

      // A response page with no policy number/status means the lookup did not
      // resolve to a policy — treat as not-found rather than a bogus record.
      if (!scraped.policyNumber && !scraped.policyStatus) {
        return { status: "not-found" };
      }

      return {
        status: "found",
        data: {
          policyNumber: scraped.policyNumber,
          insuredName: scraped.insuredName,
          effectiveDate: scraped.policyEffectiveDate,
          expirationDate: scraped.policyExpirationDate,
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
