import type { Page } from "playwright";
import type { CarrierModule, InputField } from "../types.js";
import type { AgentTask } from "../../agent/types.js";
import type {
  VerificationInput,
  VerificationResult,
} from "../../types/verification.js";
import type { CarrierCredentialPayload } from "../../types/credentials.js";
import { PolicyStatus } from "../../types/policy.js";
import {
  LOGIN_CONTEXT,
  SEARCH_CONTEXT,
  RESULTS_CONTEXT,
  EXTRACTION_CONTEXT,
  POLICY_EXTRACTION_SCHEMA,
} from "./prompts.js";

/**
 * Allstate AXCIS Lienholder Portal carrier module.
 *
 * Flow: AI-driven login → AXCIS search (Policy# + last-5 VIN, or Name + Address)
 *       → results selection → extract policy/coverage details.
 *
 * AI-only carrier — no direct HTTP API.
 */
export class AllstateModule implements CarrierModule {
  carrierId = "allstate";
  carrierName = "Allstate";
  portalUrl = "https://eaxcis.allstate.com";

  requiredInputs: InputField[] = [
    {
      name: "vin",
      required: true,
      description: "Full 17-character Vehicle Identification Number",
    },
    {
      name: "policyNumber",
      required: false,
      description:
        "Allstate policy number (used with last 5 of VIN for primary lookup)",
    },
  ];

  buildLoginTasks(credentials: CarrierCredentialPayload): AgentTask[] {
    return [
      {
        goal: `Navigate to ${this.portalUrl} and log in with the username and password. Complete any MFA/verification step using FETCH_MFA_CODE if prompted.`,
        context:
          LOGIN_CONTEXT +
          `\n\nUsername: ${credentials.username}\nPassword: ${credentials.password}`,
      },
    ];
  }

  buildSearchTasks(input: VerificationInput): AgentTask[] {
    const last5Vin = input.vin.slice(-5);
    const hasPolicyNumber = !!input.policyNumber;

    const searchGoal = hasPolicyNumber
      ? `Search using Method 1: enter policy number "${input.policyNumber}" and last 5 VIN digits "${last5Vin}", then click Lookup.`
      : `Search using Method 2: enter insured last name "${input.borrowerLastName}" and any available address details, then click Search.`;

    const searchContext =
      SEARCH_CONTEXT +
      (hasPolicyNumber
        ? `\n\nPolicy Number: ${input.policyNumber}\nLast 5 of VIN: ${last5Vin}`
        : `\n\nInsured Last Name: ${input.borrowerLastName}\nFull VIN: ${input.vin}`);

    return [
      {
        goal: searchGoal,
        context: searchContext,
      },
      {
        goal: `If you see a list of results, select the one matching VIN ending in "${last5Vin}". If you are already on a policy detail page, report DONE immediately.`,
        context:
          RESULTS_CONTEXT + `\n\nTarget VIN (last 5): ${last5Vin}`,
      },
      {
        goal: "Extract all policy and coverage details from the current page.",
        context: EXTRACTION_CONTEXT,
        extractionSchema: POLICY_EXTRACTION_SCHEMA,
      },
    ];
  }

  async isSessionActive(page: Page): Promise<boolean> {
    const url = page.url();

    // On the external/login page means not authenticated
    if (url.includes("login") || url.includes("Login") || url.includes("logon")) {
      return false;
    }

    // If we're on the Secured area, we're logged in
    if (url.includes("/Secured/") || url.includes("eaxcis.allstate.com")) {
      return true;
    }

    // Fallback: look for a logout/sign-out link
    const logoutVisible = await page
      .locator("text=/log\\s*out|sign\\s*out/i")
      .first()
      .isVisible()
      .catch(() => false);
    return logoutVisible;
  }

  normalizeResult(
    input: VerificationInput,
    rawData: Record<string, unknown>
  ): VerificationResult {
    const status = mapPolicyStatus(rawData.policyStatus as string | undefined);

    // Coverages
    const coverages = [];
    if (rawData.hasCollision === true || rawData.hasCollision === "true") {
      coverages.push({
        type: "Collision",
        deductible: parseNumber(rawData.collisionDeductible),
      });
    }
    if (rawData.hasComprehensive === true || rawData.hasComprehensive === "true") {
      coverages.push({
        type: "Comprehensive",
        deductible: parseNumber(rawData.comprehensiveDeductible),
      });
    }
    if (rawData.liabilityLimit) {
      coverages.push({
        type: "Liability",
        limit: parseNumber(rawData.liabilityLimit),
      });
    }

    // Lienholder / Interested Parties
    const interestedParties = [];
    if (rawData.lienholderName) {
      interestedParties.push({
        name: String(rawData.lienholderName),
        type: "Lienholder",
        address: rawData.lienholderAddress
          ? { addr1: String(rawData.lienholderAddress) }
          : undefined,
      });
    }

    const lossPaye = String(rawData.isLossPaye ?? "").toLowerCase();
    const isLienholderListed =
      interestedParties.length > 0 && lossPaye === "yes";

    return {
      success: status !== PolicyStatus.NOT_AVAILABLE,
      policyId: input.policyId,
      policyStatus: status,
      policyNumber: rawData.policyNumber
        ? String(rawData.policyNumber)
        : input.policyNumber,
      insuranceProvider: "Allstate",
      coveragePeriod:
        rawData.effectiveDate && rawData.expirationDate
          ? {
              startDate: String(rawData.effectiveDate),
              endDate: String(rawData.expirationDate),
            }
          : undefined,
      coverages: coverages.length > 0 ? coverages : undefined,
      isLienholderListed,
      interestedParties:
        interestedParties.length > 0 ? interestedParties : undefined,
      rawData,
      agentSteps: 0, // filled by caller
      durationMs: 0, // filled by caller
    };
  }
}

function mapPolicyStatus(raw: string | undefined): PolicyStatus {
  if (!raw) return PolicyStatus.NOT_AVAILABLE;
  const upper = raw.toUpperCase().trim();
  if (upper.includes("ACTIVE") || upper.includes("IN FORCE"))
    return PolicyStatus.ACTIVE;
  if (upper.includes("CANCEL")) return PolicyStatus.CANCELLED;
  if (upper.includes("EXPIRE")) return PolicyStatus.EXPIRED;
  if (upper.includes("PENDING")) return PolicyStatus.PENDING_ACTIVATION;
  return PolicyStatus.NOT_AVAILABLE;
}

function parseNumber(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  const n = Number(String(val).replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? undefined : n;
}
