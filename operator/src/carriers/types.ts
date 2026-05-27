export interface PolicyInput {
  policyId: string;
  vin: string;
  borrowerLastName: string;
  borrowerFirstName?: string;
  policyNumber?: string;
  insuranceProvider?: string;
}

export interface PolicyScrape {
  policyNumber?: string;
  insuredName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  coverages?: Record<string, string | number | boolean>;
  raw?: Record<string, unknown>;
}

export type ScrapeResult =
  | { status: "found"; data: PolicyScrape }
  | { status: "not-found" }
  | { status: "error"; reason: string }
  | { status: "needs-review"; reviewId: string };

export interface ReviewOption {
  id: string;
  label: string;
  description?: string;
}

export type AiAction =
  | { action: "click"; selectorHint: string }
  | { action: "type"; selectorHint: string; text: string }
  | { action: "pause-for-human"; reason: string };

export interface AdapterContext {
  runId: string;
  policyId: string;
  log: (msg: string, data?: unknown) => void;
  screenshot: (label: string) => Promise<string>;
  requestHumanReview: (prompt: string, options: ReviewOption[]) => Promise<string>;
  aiAssist?: (prompt: string) => Promise<AiAction>;
}

// Re-exported here so adapter files don't import directly from playwright-core
// (kept as a type-only import inside adapters).
export type { Page } from "playwright-core";
import type { Page } from "playwright-core";

export interface CarrierAdapter {
  id: string;
  name: string;
  loginUrl: string;
  searchUrl: string;
  isLoggedIn(page: Page): Promise<boolean>;
  verifyVin(page: Page, policy: PolicyInput, ctx: AdapterContext): Promise<ScrapeResult>;
}
