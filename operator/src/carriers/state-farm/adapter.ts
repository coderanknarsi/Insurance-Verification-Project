import type { Page } from "playwright-core";
import type {
  AdapterContext,
  CarrierAdapter,
  PolicyInput,
  ScrapeResult,
} from "../types";

const LOGIN_URL = "https://b2b.statefarm.com/b2b/InsuranceInquiry/start";
const SEARCH_URL = "https://b2b.statefarm.com/b2b/InsuranceInquiry/searchAuto";

export const stateFarmAdapter: CarrierAdapter = {
  id: "state-farm",
  name: "State Farm B2B",
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,

  async isLoggedIn(page: Page): Promise<boolean> {
    // Heartbeat: load the search page. If we end up at the login form, we're out.
    // Implemented in Phase 2.
    void page;
    throw new Error("stateFarmAdapter.isLoggedIn not implemented (Phase 2)");
  },

  async verifyVin(
    page: Page,
    policy: PolicyInput,
    ctx: AdapterContext,
  ): Promise<ScrapeResult> {
    // Phase 4: deterministic Playwright flow:
    //   1. Navigate to search page if not already there.
    //   2. Fill VIN + last name.
    //   3. Click Search; wait for navigation/results.
    //   4. If Auto Selection screen: pick single row OR open human review.
    //   5. Scrape policy detail page.
    //   6. Back to search.
    void page;
    void policy;
    ctx.log("stateFarmAdapter.verifyVin called (not implemented)");
    return { status: "error", reason: "not implemented (Phase 4)" };
  },
};
