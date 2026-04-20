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

export class NationalGeneralModule implements CarrierModule {
  carrierId = "national_general";
  carrierName = "National General";
  portalUrl = "https://lienholderverification.com";

  requiredInputs: InputField[] = [
    { name: "vin", required: true, description: "Vehicle Identification Number" },
    { name: "borrowerLastName", required: true, description: "Borrower last name" },
    { name: "policyNumber", required: true, description: "Policy number" },
  ];

  buildLoginTasks(credentials: CarrierCredentialPayload): AgentTask[] {
    return [
      {
        goal: `Navigate to ${this.portalUrl} and log in with username "${credentials.username}" and password.`,
        context:
          LOGIN_CONTEXT +
          `\n\nUsername: ${credentials.username}\nPassword: ${credentials.password}`,
      },
    ];
  }

  buildSearchTasks(input: VerificationInput): AgentTask[] {
    // National General wants only the last 8 digits of the VIN
    const vinLast8 = input.vin.length > 8 ? input.vin.slice(-8) : input.vin;

    const tasks: AgentTask[] = [
      {
        goal: `Search for a policy using Last Name "${input.borrowerLastName}", VIN (last 8 digits) "${vinLast8}", and Policy Number "${input.policyNumber ?? ""}".`,
        context:
          SEARCH_CONTEXT +
          `\n\nLast Name: ${input.borrowerLastName}` +
          `\nVIN (last 8): ${vinLast8}` +
          (input.policyNumber ? `\nPolicy Number: ${input.policyNumber}` : ""),
      },
      {
        goal: `Review the search results and find the policy for "${input.borrowerLastName}" with VIN ending in "${vinLast8}".`,
        context: RESULTS_CONTEXT,
      },
      {
        goal: "Extract all policy details from the current page.",
        context: EXTRACTION_CONTEXT,
        extractionSchema: POLICY_EXTRACTION_SCHEMA,
      },
    ];
    return tasks;
  }

  async isSessionActive(page: Page): Promise<boolean> {
    const url = page.url();
    // Login page means not authenticated
    if (url.includes("/login") || url.includes("/signin") || url.includes("/Account")) {
      return false;
    }

    // Check for logged-in indicator (portal shows "Hello, user@email! Logout")
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
      insuranceProvider: "National General",
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
