import type { Page } from "playwright-core";
import type {
  AdapterContext,
  CarrierAdapter,
  PolicyInput,
  ScrapeResult,
} from "../types";

const LOGIN_URL = "https://apps.b2b.statefarm.com/login";
// The Insurance Inquiry Tool's policy search page. Hitting it while
// authenticated lands on a URL containing this fragment. While unauthenticated
// it redirects back to /login.
const SEARCH_URL =
  "https://apps.b2b.statefarm.com/b2b/InsuranceInquiry/policySearch";
const SEARCH_URL_FRAGMENT = "InsuranceInquiry/policySearch";
const LOGIN_URL_FRAGMENT = "/login";

export const stateFarmAdapter: CarrierAdapter = {
  id: "state-farm",
  name: "State Farm B2B",
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,

  async isLoggedIn(page: Page): Promise<boolean> {
    // Heartbeat: visit the policy-search page. If we land on the login page,
    // the session is gone.
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
    if (url.includes(SEARCH_URL_FRAGMENT)) {
      return true;
    }
    // Fallback: look for the VIN input as a positive signal.
    try {
      const vinInput = await page.$('input[name="vin"], input[id*="vin" i]');
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
    void page;
    void policy;
    ctx.log("stateFarmAdapter.verifyVin called (not implemented)");
    return { status: "error", reason: "not implemented (Phase 4)" };
  },
};
