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
 * Nationwide carrier module.
 *
 * Login: identity.nationwide.com 2-step OAuth (username → password) then email MFA.
 * Search: policyinquiry.nationwide.com/policy-search — "Yes" path with Policy# + VIN last 6.
 *
 * NOTE: The "No" search path (Address + State + ZIP + full VIN) is supported by the
 * portal but not by the current `VerificationInput` schema. If a borrower has no
 * policy number on file we currently can't verify via Nationwide.
 */
export class NationwideModule implements CarrierModule {
  carrierId = "nationwide";
  carrierName = "Nationwide";
  portalUrl = "https://policyinquiry.nationwide.com";

  requiredInputs: InputField[] = [
    { name: "vin", required: true, description: "Vehicle Identification Number" },
    { name: "borrowerLastName", required: true, description: "Borrower last name" },
    { name: "policyNumber", required: true, description: "Policy number" },
  ];

  buildLoginTasks(credentials: CarrierCredentialPayload): AgentTask[] {
    return [
      {
        goal: `Navigate to ${this.portalUrl} and complete the 2-step Nationwide login with username "${credentials.username}" and password, then complete email-based MFA.`,
        context:
          LOGIN_CONTEXT +
          `\n\nUsername: ${credentials.username}\nPassword: ${credentials.password}`,
      },
    ];
  }

  buildSearchTasks(input: VerificationInput): AgentTask[] {
    // Nationwide's "Yes" path wants the LAST 6 digits of the VIN.
    const vinLast6 = input.vin.length > 6 ? input.vin.slice(-6) : input.vin;
    const policyNumber = input.policyNumber ?? "";

    return [
      {
        goal: `On the policy search page, choose "Yes" for "Do you have the policy number?", then search with Policy Number "${policyNumber}" and VIN (last 6) "${vinLast6}".`,
        context:
          SEARCH_CONTEXT +
          `\n\nPolicy Number: ${policyNumber}` +
          `\nVIN (last 6): ${vinLast6}` +
          `\nBorrower Last Name (for verification only): ${input.borrowerLastName}`,
      },
      {
        goal: `Open the policy result that matches policy number "${policyNumber}" and VIN ending in "${vinLast6}".`,
        context: RESULTS_CONTEXT,
      },
      {
        goal: "Extract all policy details from the current Nationwide policy detail page.",
        context: EXTRACTION_CONTEXT,
        extractionSchema: POLICY_EXTRACTION_SCHEMA,
      },
    ];
  }

  async isSessionActive(page: Page): Promise<boolean> {
    const url = page.url();
    // Auth host means we're not logged in.
    if (url.includes("identity.nationwide.com")) {
      return false;
    }
    // Login / signin paths.
    if (url.includes("/login") || url.includes("/signin")) {
      return false;
    }
    // Logged-in indicator: a "Log out" / "Sign out" link is visible.
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
      insuranceProvider: "Nationwide",
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
