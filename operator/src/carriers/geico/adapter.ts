import type { Page } from "playwright-core";
import type { CarrierAdapter, ScrapeResult } from "../types";

const LOGIN_URL = "https://gateway.geico.com/";
const SEARCH_URL = "https://gateway.geico.com/";

export const geicoAdapter: CarrierAdapter = {
  id: "geico",
  name: "GEICO Agent Gateway",
  loginUrl: LOGIN_URL,
  searchUrl: SEARCH_URL,
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (!url.includes("geico.com")) return false;
      return !/login|signin/i.test(url);
    } catch {
      return false;
    }
  },
  async verifyVin(): Promise<ScrapeResult> {
    return { status: "error", reason: "GEICO adapter not yet implemented (Phase 7 stub)" };
  },
};
