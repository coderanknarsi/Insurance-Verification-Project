import type { Browser, BrowserContext, Page } from "playwright-core";
import { getCarrierAdapter } from "../carriers/registry";
import type {
  AdapterContext,
  CarrierAdapter,
  PolicyInput,
  ReviewOption,
  ScrapeResult,
} from "../carriers/types";
import { logger } from "../shared/logger";
import { AiAssistant } from "./ai-assist";

export interface CapturedScreenshot {
  label: string;
  base64: string; // PNG, base64 (no data URL prefix)
}

export interface RunPolicyResult {
  result: ScrapeResult;
  screenshots: CapturedScreenshot[];
  logs: Array<{ ts: number; msg: string; data?: unknown }>;
  durationMs: number;
}

export type HumanReviewBridge = (review: {
  runId: string;
  policyId: string;
  prompt: string;
  options: ReviewOption[];
  screenshotLabel?: string;
}) => Promise<string>;

/**
 * Capture a PNG of the page as base64. Prefers the Chrome DevTools Protocol
 * `Page.captureScreenshot`, which (unlike Playwright's `page.screenshot`) does
 * NOT block on `document.fonts.ready`. Carrier portals frequently stall web
 * font loading, which made the Playwright path time out and drop the audit
 * screenshot entirely. Falls back to Playwright's screenshot if CDP is
 * unavailable. Returns null only if both paths fail (verification still
 * proceeds — screenshots are best-effort).
 */
async function captureScreenshot(
  page: Page,
  label: string,
): Promise<string | null> {
  try {
    const client = await page.context().newCDPSession(page);
    try {
      const { data } = (await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      })) as { data: string };
      return data; // already base64, no data URL prefix
    } finally {
      await client.detach().catch(() => undefined);
    }
  } catch (cdpErr) {
    logger.warn(`Screenshot ${label} CDP capture failed; trying Playwright`, {
      error: String(cdpErr),
    });
    try {
      const buf = await page.screenshot({
        fullPage: false,
        type: "png",
        timeout: 8_000,
        animations: "disabled",
        caret: "hide",
      });
      return buf.toString("base64");
    } catch (err) {
      logger.warn(`Screenshot ${label} failed`, { error: String(err) });
      return null;
    }
  }
}

/**
 * Drives one VIN through a carrier adapter on the managed Chrome browser.
 *
 * Owns a dedicated "verification page" per carrier so the user's other tabs
 * aren't disturbed. Screenshots are captured into memory and returned to the
 * renderer, which uploads them to Firebase Storage.
 */
export class OperatorRunEngine {
  private browser: Browser | null = null;
  private carrierPages = new Map<string, Page>();
  private ai = new AiAssistant();

  setBrowser(browser: Browser | null): void {
    if (this.browser !== browser) {
      // Old pages are tied to the old browser; drop refs.
      this.carrierPages.clear();
    }
    this.browser = browser;
  }

  async runPolicy(params: {
    runId: string;
    carrierId: string;
    policy: PolicyInput;
    onHumanReview: HumanReviewBridge;
  }): Promise<RunPolicyResult> {
    if (!this.browser) {
      throw new Error("Chrome is not connected");
    }
    const adapter = getCarrierAdapter(params.carrierId);
    if (!adapter) {
      throw new Error(`Unknown carrier: ${params.carrierId}`);
    }

    const startedAt = Date.now();
    const screenshots: CapturedScreenshot[] = [];
    const logs: RunPolicyResult["logs"] = [];

    const page = await this.acquirePage(adapter);

    const ctx: AdapterContext = {
      runId: params.runId,
      policyId: params.policy.policyId,
      log: (msg, data) => {
        logs.push({ ts: Date.now(), msg, data });
        logger.info(
          `[run-engine][${params.runId}][${params.policy.policyId}] ${msg}`,
          data ? { data } : undefined,
        );
      },
      screenshot: async (label: string) => {
        const base64 = await captureScreenshot(page, label);
        if (base64) {
          screenshots.push({ label, base64 });
        }
        return label; // Storage path is assigned by the renderer at upload time.
      },
      requestHumanReview: async (prompt, options) => {
        const lastShot = screenshots[screenshots.length - 1]?.label;
        return params.onHumanReview({
          runId: params.runId,
          policyId: params.policy.policyId,
          prompt,
          options,
          screenshotLabel: lastShot,
        });
      },
      aiAssist: this.ai.isEnabled()
        ? async (prompt: string) => this.ai.suggest(prompt)
        : undefined,
    };

    this.ai.resetForVin();

    let result: ScrapeResult;
    try {
      result = await adapter.verifyVin(page, params.policy, ctx);
    } catch (err) {
      result = {
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      result,
      screenshots,
      logs,
      durationMs: Date.now() - startedAt,
    };
  }

  private async acquirePage(adapter: CarrierAdapter): Promise<Page> {
    if (!this.browser) throw new Error("Chrome is not connected");
    const carrierId = adapter.id;
    const existing = this.carrierPages.get(carrierId);
    if (existing && !existing.isClosed()) return existing;

    const contexts = this.browser.contexts();
    const context: BrowserContext =
      contexts.length > 0 ? contexts[0] : await this.browser.newContext();

    // Prefer a tab the user already has open on this carrier's search page.
    // Some portals (e.g. State Farm's Insurance Inquiry tool) run on a
    // session-scoped host the user reaches manually, so opening a fresh tab
    // and navigating would drop their session and land on the generic portal.
    const fragment = adapter.searchPageFragment;
    if (fragment) {
      for (const p of context.pages()) {
        if (!p.isClosed() && p.url().includes(fragment)) {
          this.bindPage(carrierId, p);
          return p;
        }
      }
    }

    const page = await context.newPage();
    this.bindPage(carrierId, page);
    return page;
  }

  private bindPage(carrierId: string, page: Page): void {
    page.on("close", () => {
      if (this.carrierPages.get(carrierId) === page) {
        this.carrierPages.delete(carrierId);
      }
    });
    this.carrierPages.set(carrierId, page);
  }
}
