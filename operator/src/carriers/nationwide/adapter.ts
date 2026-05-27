import type { Page } from "playwright-core";
import type { CarrierAdapter, ScrapeResult } from "../types";

const LOGIN_URL = "https://agentcenter.nationwide.com/";
const SEARCH_URL = "https://agentcenter.nationwide.com/";

export const nationwideAdapter: CarrierAdapter = {
  id: "nationwide",
  name: "Nationwide Agent Center",
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (!url.includes("nationwide.com")) return false;
      return !/login|signin/i.test(url);
    } catch {
      return false;
    }
  },
  async verifyVin(): Promise<ScrapeResult> {
    return { status: "error", reason: "Nationwide adapter not yet implemented (Phase 7 stub)" };
  },
};
