import type { Page } from "playwright-core";
import type { CarrierAdapter, ScrapeResult } from "../types";

const LOGIN_URL = "https://www.allstateagent.com/login";
const SEARCH_URL = "https://www.allstateagent.com/";

export const allstateAdapter: CarrierAdapter = {
  id: "allstate",
  name: "Allstate Agent",
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (!url.includes("allstateagent.com")) return false;
      return !/login/i.test(url);
    } catch {
      return false;
    }
  },
  async verifyVin(): Promise<ScrapeResult> {
    return { status: "error", reason: "Allstate adapter not yet implemented (Phase 7 stub)" };
  },
};
