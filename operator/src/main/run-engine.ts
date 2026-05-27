import type { Browser, BrowserContext, Page } from "playwright-core";
import { getCarrierAdapter } from "../carriers/registry";
import type {
  AdapterContext,
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

    const page = await this.acquirePage(adapter.id);

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
        try {
          const buf = await page.screenshot({
            fullPage: false,
            type: "png",
            timeout: 5_000,
          });
          screenshots.push({ label, base64: buf.toString("base64") });
        } catch (err) {
          logger.warn(`Screenshot ${label} failed`, { error: String(err) });
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

  private async acquirePage(carrierId: string): Promise<Page> {
    if (!this.browser) throw new Error("Chrome is not connected");
    const existing = this.carrierPages.get(carrierId);
    if (existing && !existing.isClosed()) return existing;

    const contexts = this.browser.contexts();
    const context: BrowserContext =
      contexts.length > 0 ? contexts[0] : await this.browser.newContext();
    const page = await context.newPage();
    page.on("close", () => {
      if (this.carrierPages.get(carrierId) === page) {
        this.carrierPages.delete(carrierId);
      }
    });
    this.carrierPages.set(carrierId, page);
    return page;
  }
}
