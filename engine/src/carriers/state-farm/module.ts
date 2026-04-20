import type { Page } from "playwright";
import type { CarrierModule, InputField } from "../types.js";
import type { AgentTask } from "../../agent/types.js";
import type { VerificationInput, VerificationResult } from "../../types/verification.js";
import type { CarrierCredentialPayload } from "../../types/credentials.js";
import { PolicyStatus } from "../../types/policy.js";
import {
  LOGIN_CONTEXT,
  NAVIGATE_TO_INQUIRY_CONTEXT,
  SEARCH_CONTEXT,
  AUTO_SELECTION_CONTEXT,
  EXTRACTION_CONTEXT,
  POLICY_EXTRACTION_SCHEMA,
} from "./prompts.js";

/**
 * State Farm B2B Portal carrier module.
 *
 * Flow: AI-driven login (with email MFA) → navigate to Insurance Inquiry Tool
 *       → VIN search → optional auto selection → extract policy details.
 *
 * This is an AI-only carrier (no direct HTTP API). The agent navigates the
 * full browser flow for every search, similar to National General.
 */
export class StateFarmModule implements CarrierModule {
  carrierId = "state_farm";
  carrierName = "State Farm";
  portalUrl = "https://b2b-login-app.digital.statefarm.com/UI/Login";

  requiredInputs: InputField[] = [
    {
      name: "vin",
      required: true,
      description: "Full 17-character Vehicle Identification Number",
    },
  ];

  buildLoginTasks(credentials: CarrierCredentialPayload): AgentTask[] {
    return [
      {
        goal: `Navigate to ${this.portalUrl} and log in with the B2B ID and password. Complete the email MFA verification step using FETCH_MFA_CODE when prompted for a verification code.`,
        context:
          LOGIN_CONTEXT +
          `\n\nB2B ID: ${credentials.username}\nPassword: ${credentials.password}`,
      },
      {
        goal: `Navigate from the B2B portal homepage to the Insurance Inquiry Tool search page.`,
        context: NAVIGATE_TO_INQUIRY_CONTEXT,
      },
    ];
  }

  buildSearchTasks(input: VerificationInput): AgentTask[] {
    const tasks: AgentTask[] = [
      {
        goal: `Search for a vehicle using the Full VIN field with VIN "${input.vin}".`,
        context:
          SEARCH_CONTEXT +
          `\n\nFull VIN: ${input.vin}` +
          (input.borrowerLastName
            ? `\nBorrower Last Name: ${input.borrowerLastName}`
            : ""),
      },
      {
        goal: `If you are on an Auto Selection page with multiple vehicles, select the correct one. If you are already on the Policy Information page, report DONE immediately.`,
        context:
          AUTO_SELECTION_CONTEXT +
          `\n\nTarget VIN: ${input.vin}` +
          (input.borrowerLastName
            ? `\nTarget Borrower Last Name: ${input.borrowerLastName}`
            : ""),
      },
      {
        goal: "Extract all policy details from the current Policy Information page.",
        context: EXTRACTION_CONTEXT,
        extractionSchema: POLICY_EXTRACTION_SCHEMA,
      },
    ];
    return tasks;
  }

  async isSessionActive(page: Page): Promise<boolean> {
    const url = page.url();

    // On login page means not authenticated
    if (
      url.includes("b2b-login-app") ||
      url.includes("/Login") ||
      url.includes("/login")
    ) {
      return false;
    }

    // If we're on a b2b.statefarm.com or the inquiry tool, we're likely logged in
    if (
      url.includes("b2b.statefarm.com") ||
      url.includes("InsuranceInquiry")
    ) {
      return true;
    }

    // Fallback: check for a logout link
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
    // Bodily Injury + Property Damage → Liability
    const biLimit = parseNumber(rawData.bodilyInjuryLimitPerAccident);
    const pdLimit = parseNumber(rawData.propertyDamageLimitPerAccident);
    if (biLimit || pdLimit) {
      coverages.push({
        type: "Liability",
        limit: biLimit ?? pdLimit,
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

    // Loss Payee flag: "Yes" means lienholder is properly listed
    const lossPaye = String(rawData.lossPaye ?? "").toLowerCase();
    const isLienholderListed =
      interestedParties.length > 0 && lossPaye === "yes";

    // Date mapping — State Farm specific:
    // "Policy Origin Date" = coverage START date
    // "Policy Effective Date" = coverage END/EXPIRATION date
    const startDate = rawData.policyOriginDate
      ? String(rawData.policyOriginDate)
      : undefined;
    const endDate = rawData.policyEffectiveDate
      ? String(rawData.policyEffectiveDate)
      : undefined;

    return {
      success: status !== PolicyStatus.NOT_AVAILABLE,
      policyId: input.policyId,
      policyStatus: status,
      policyNumber: rawData.policyNumber
        ? String(rawData.policyNumber)
        : input.policyNumber,
      insuranceProvider: "State Farm",
      coveragePeriod:
        startDate && endDate
          ? { startDate, endDate }
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
  return isNaN(n) ? undefined : n;
}
