import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getProxyUrl, isProxyConfigured } from "./proxy.js";
import { generateStealthProfile, STEALTH_INIT_SCRIPT } from "./stealth.js";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
  /** Extract all cookies from the browser context (for hybrid HTTP flow) */
  getCookies: () => Promise<Array<{ name: string; value: string; domain: string; path: string }>>;
}

/**
 * Launches a stealth Chromium browser session.
 * Blocks images/media to minimize bandwidth through the proxy.
 * Returns a session with browser, context, and page — caller must close when done.
 */
export async function launchBrowser(): Promise<BrowserSession> {
  const profile = generateStealthProfile();
  const useProxy = isProxyConfigured();

  console.log(`[browser] Launching with proxy=${useProxy}`);
  if (useProxy) {
    console.log(`[browser] Proxy host: gate.smartproxy.com:10001`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-infobars",
      "--disable-background-timer-throttling",
    ],
    ...(useProxy ? { proxy: { server: getProxyUrl() } } : {}),
  });

  const context = await browser.newContext({
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    locale: profile.locale,
    timezoneId: profile.timezone,
    // Block images, media, fonts to save proxy bandwidth
    bypassCSP: true,
  });

  // Inject stealth script before any page loads
  await context.addInitScript(STEALTH_INIT_SCRIPT);

  // Block heavy resource types to save bandwidth
  await context.route("**/*", (route) => {
    const resourceType = route.request().resourceType();
    if (["image", "media", "font"].includes(resourceType)) {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();

  const close = async () => {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  };

  const getCookies = async () => {
    const cookies = await context.cookies();
    return cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
  };

  return { browser, context, page, close, getCookies };
}
