import type { Page } from "playwright-core";
import type { CarrierAdapter, ScrapeResult } from "../types";

const LOGIN_URL = "https://www.foragentsonly.com/";
const SEARCH_URL = "https://www.foragentsonly.com/";

export const progressiveAdapter: CarrierAdapter = {
  id: "progressive",
  name: "Progressive (ForAgentsOnly)",
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (!url.includes("foragentsonly.com")) return false;
      return !/login|sign[-_ ]?in/i.test(url);
    } catch {
      return false;
    }
  },
  async verifyVin(): Promise<ScrapeResult> {
    return { status: "error", reason: "Progressive adapter not yet implemented (Phase 7 stub)" };
  },
};
