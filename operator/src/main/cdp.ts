import { chromium, Browser } from "playwright-core";
import { logger } from "../shared/logger";

const CONNECT_RETRY_DELAY_MS = 500;
const CONNECT_RETRY_MAX = 30;

export async function connectToManagedChrome(debugPort: number): Promise<Browser> {
  const url = `http://127.0.0.1:${debugPort}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CONNECT_RETRY_MAX; attempt++) {
    try {
      const browser = await chromium.connectOverCDP(url);
      logger.info("Connected to managed Chrome via CDP", { url, attempt });
      return browser;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, CONNECT_RETRY_DELAY_MS));
    }
  }
  logger.error("Failed to connect to managed Chrome", { url, error: String(lastErr) });
  throw new Error(`Could not connect to managed Chrome at ${url}: ${String(lastErr)}`);
}
