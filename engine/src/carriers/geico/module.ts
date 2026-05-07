import type { Page } from "playwright";
import type { CarrierModule, InputField } from "../types.js";
import type { AgentTask } from "../../agent/types.js";
import type { VerificationInput, VerificationResult } from "../../types/verification.js";
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
 * GEICO B2B Lienholder / Dealer carrier module.
 *
 * Login: partners.geico.com/lienholders/logon.aspx (User ID + Password). May show
 *        a Terms of Use acceptance page on first login.
 * Search: Coverage Verification with Policy Number + VIN (last 4-5 chars).
 * No MFA.
 *
 * NOTE: The "No policy number?" branch (SSN / phone / name+state+ZIP) is supported
 * by the portal but not by `VerificationInput` today, so we require a policy number.
 */
export class GeicoModule implements CarrierModule {
  carrierId = "geico";
  carrierName = "GEICO";
  portalUrl = "https://partners.geico.com/lienholders/logon.aspx";

  requiredInputs: InputField[] = [
    { name: "vin", required: true, description: "Vehicle Identification Number" },
    { name: "borrowerLastName", required: true, description: "Borrower last name" },
    { name: "policyNumber", required: true, description: "Policy number" },
  ];

  buildLoginTasks(credentials: CarrierCredentialPayload): AgentTask[] {
    return [
      {
        goal: `Navigate to ${this.portalUrl} and log in to the GEICO B2B portal with User ID "${credentials.username}" and password. Accept the Terms of Use if prompted.`,
        context:
          LOGIN_CONTEXT +
          `\n\nUser ID: ${credentials.username}\nPassword: ${credentials.password}`,
      },
    ];
  }

  buildSearchTasks(input: VerificationInput): AgentTask[] {
    // GEICO accepts last 4 or 5 characters of the VIN — we use last 5.
    const vinLast5 = input.vin.length > 5 ? input.vin.slice(-5) : input.vin;
    const policyNumber = input.policyNumber ?? "";

    return [
      {
        goal: `On the GEICO Coverage Verification page, enter Policy Number "${policyNumber}" and VIN (last 5) "${vinLast5}", then click SEARCH.`,
        context:
          SEARCH_CONTEXT +
          `\n\nPolicy Number: ${policyNumber}` +
          `\nVIN (last 5): ${vinLast5}` +
          `\nBorrower Last Name (for verification only): ${input.borrowerLastName}`,
      },
      {
        goal: `Open the policy result that matches policy number "${policyNumber}" and VIN ending in "${vinLast5}".`,
        context: RESULTS_CONTEXT,
      },
      {
        goal: "Extract all policy details from the current GEICO Coverage Verification page.",
        context: EXTRACTION_CONTEXT,
        extractionSchema: POLICY_EXTRACTION_SCHEMA,
      },
    ];
  }

  async isSessionActive(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes("logon.aspx") || url.includes("/login") || url.includes("/signin")) {
      return false;
    }
    // Logged-in portal shows a "Welcome: <name>" header and/or a logout link.
    const loggedIn = await page
      .locator("text=/welcome\\s*:|log\\s*out|sign\\s*out/i")
      .first()
      .isVisible()
      .catch(() => false);
    return loggedIn;
  }

  normalizeResult(
    input: VerificationInput,
    rawData: Record<string, unknown>
  ): VerificationResult {
    const status = mapPolicyStatus(rawData.policyStatus as string | undefined);

    const coverages = [];
    if (rawData.hasComprehensive === true || rawData.hasComprehensive === "true") {
      coverages.push({
        type: "Comprehensive",
        deductible: parseNumber(rawData.comprehensiveDeductible),
      });
    }
    if (rawData.hasCollision === true || rawData.hasCollision === "true") {
      coverages.push({
        type: "Collision",
        deductible: parseNumber(rawData.collisionDeductible),
      });
    }
    if (rawData.liabilityLimit) {
      coverages.push({
        type: "Liability",
        limit: parseNumber(rawData.liabilityLimit),
      });
    }

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

    const drivers = [];
    if (rawData.drivers && typeof rawData.drivers === "string") {
      for (const name of rawData.drivers.split(",")) {
        const trimmed = name.trim();
        if (trimmed) drivers.push({ fullName: trimmed });
      }
    }

    return {
      success: status !== PolicyStatus.NOT_AVAILABLE,
      policyId: input.policyId,
      policyStatus: status,
      policyNumber: rawData.policyNumber ? String(rawData.policyNumber) : input.policyNumber,
      insuranceProvider: "GEICO",
      coveragePeriod:
        rawData.effectiveDate && rawData.expirationDate
          ? {
              startDate: String(rawData.effectiveDate),
              endDate: String(rawData.expirationDate),
            }
          : undefined,
      coverages: coverages.length > 0 ? coverages : undefined,
      isLienholderListed: interestedParties.length > 0,
      interestedParties: interestedParties.length > 0 ? interestedParties : undefined,
      drivers: drivers.length > 0 ? drivers : undefined,
      rawData,
      agentSteps: 0,
      durationMs: 0,
    };
  }
}

function mapPolicyStatus(raw: string | undefined): PolicyStatus {
  if (!raw) return PolicyStatus.NOT_AVAILABLE;
  const upper = raw.toUpperCase().trim();
  if (upper.includes("ACTIVE") || upper.includes("IN FORCE")) return PolicyStatus.ACTIVE;
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
