import type { Page } from "playwright";
import type { AgentTask } from "../agent/types.js";
import type { VerificationInput, VerificationResult } from "../types/verification.js";
import type { CarrierCredentialPayload } from "../types/credentials.js";

/** Fields that a carrier module requires to perform a lookup */
export interface InputField {
  name: string;
  required: boolean;
  description: string;
}

/**
 * Every carrier module implements this interface.
 * Adding a new carrier = implementing this + registering in the registry.
 */
export interface CarrierModule {
  /** Unique lowercase identifier (e.g., "progressive") */
  carrierId: string;

  /** Display name (e.g., "Progressive") */
  carrierName: string;

  /** Portal login URL */
  portalUrl: string;

  /** What input fields are needed for a lookup */
  requiredInputs: InputField[];

  /**
   * Login to the carrier portal. Called once per browser session.
   * The agent loop navigates the login form using the provided credentials.
   */
  buildLoginTasks(credentials: CarrierCredentialPayload): AgentTask[];

  /**
   * Build the task sequence for looking up a single policy.
   * Called once per policy within an authenticated session.
   */
  buildSearchTasks(input: VerificationInput): AgentTask[];

  /**
   * Check if the current page indicates we're still logged in.
   */
  isSessionActive(page: Page): Promise<boolean>;

  /**
   * Normalize the raw data extracted by the agent into a VerificationResult.
   */
  normalizeResult(
    input: VerificationInput,
    rawData: Record<string, unknown>
  ): VerificationResult;
}

/**
 * Carriers that support direct HTTP search after an AI-driven login.
 * This enables the hybrid flow: AI login once → HTTP search at scale.
 */
export interface DirectSearchCapable {
  /** Login via AI agent, extract cookies, return a reusable session object. */
  createSession(credentials: CarrierCredentialPayload): Promise<unknown>;

  /** Search for a single policy using direct HTTP (no browser). */
  searchDirect(
    session: unknown,
    input: VerificationInput
  ): Promise<VerificationResult>;

  /** Check if the session is still likely valid (age/cookie check). */
  isSessionValid(session: unknown): boolean;
}

/** Type guard: does this carrier support direct HTTP search? */
export function isDirectSearchCapable(
  mod: CarrierModule
): mod is CarrierModule & DirectSearchCapable {
  return "searchDirect" in mod && "createSession" in mod;
}
