import type { Page } from "playwright-core";
import type { CarrierAdapter, ScrapeResult } from "../types";

const LOGIN_URL = "https://www.natgenagency.com/";
const SEARCH_URL = "https://www.natgenagency.com/";

export const nationalGeneralAdapter: CarrierAdapter = {
  id: "national-general",
  name: "National General Agency",
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (!url.includes("natgenagency.com")) return false;
      return !/login|signin/i.test(url);
    } catch {
      return false;
    }
  },
  async verifyVin(): Promise<ScrapeResult> {
    return { status: "error", reason: "National General adapter not yet implemented (Phase 7 stub)" };
  },
};
