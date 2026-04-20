import type { Page } from "playwright";
import type { CarrierModule, InputField, DirectSearchCapable } from "../types.js";
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

import {
  createProveSession,
  isSessionFresh,
  type ProveSession,
} from "./session.js";
import {
  searchPolicy,
  SessionExpiredError,
} from "./http-client.js";

export { SessionExpiredError };

export class ProgressiveModule implements CarrierModule, DirectSearchCapable {
  carrierId = "progressive";
  carrierName = "Progressive";
  portalUrl = "https://prove.progressive.com";

  requiredInputs: InputField[] = [
    { name: "vin", required: true, description: "Full 17-character Vehicle Identification Number" },
    { name: "policyNumber", required: false, description: "Policy number (optional — enables policy number search with last 6 of VIN)" },
    { name: "borrowerLastName", required: false, description: "Borrower last name for result confirmation" },
  ];

  buildLoginTasks(credentials: CarrierCredentialPayload): AgentTask[] {
    return [
      {
        goal: `Log into the Progressive PROVE portal. Enter credentials, accept the user agreement, complete 2-step email verification, and reach the "Find a Policy" search page.`,
        context:
          LOGIN_CONTEXT +
          `\n\nUsername: ${credentials.username}\nPassword: ${credentials.password}`,
      },
    ];
  }

  buildSearchTasks(input: VerificationInput): AgentTask[] {
    const useFullVin = !input.policyNumber;
    const vinLast6 = input.vin.slice(-6);

    const searchGoal = useFullVin
      ? `Search for a vehicle using "Full VIN or HIN" mode with VIN "${input.vin}". Select the "Full VIN or HIN" radio button, leave vehicle type as "Auto", enter the full VIN, and click Submit.`
      : `Search using "Policy number" mode with policy number "${input.policyNumber}" and last 6 of VIN "${vinLast6}". Select the "Policy number" radio button, enter the policy number, enter "${vinLast6}" in the last-six field, and click Submit.`;

    const tasks: AgentTask[] = [
      {
        goal: searchGoal,
        context:
          SEARCH_CONTEXT +
          `\n\nFull VIN: ${input.vin}` +
          `\nLast 6 of VIN: ${vinLast6}` +
          (input.policyNumber ? `\nPolicy Number: ${input.policyNumber}` : "") +
          (input.borrowerLastName ? `\nBorrower Last Name: ${input.borrowerLastName}` : ""),
      },
      {
        goal: `Find and select the policy result for VIN "${input.vin}".`,
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
    // If we're on a login page, we're not logged in
    if (url.includes("/login") || url.includes("/signin")) return false;

    // Check for common logged-in indicators
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
      insuranceProvider: "Progressive",
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
      agentSteps: 0, // will be filled by caller
      durationMs: 0, // will be filled by caller
    };
  }

  // ──── DirectSearchCapable methods ────

  async createSession(
    credentials: CarrierCredentialPayload
  ): Promise<ProveSession> {
    return createProveSession(credentials);
  }

  async searchDirect(
    session: unknown,
    input: VerificationInput
  ): Promise<VerificationResult> {
    const proveSession = session as ProveSession;
    const start = Date.now();

    try {
      const response = await searchPolicy(proveSession, input.vin, input.policyNumber);

      if (!response) {
        return {
          success: false,
          policyId: input.policyId,
          policyStatus: PolicyStatus.NOT_AVAILABLE,
          insuranceProvider: "Progressive",
          errorReason: "No results found",
          agentSteps: 0,
          durationMs: Date.now() - start,
        };
      }

      const policy = response.policies;
      const vehicle = policy.vehicles;
      const activeTerm = policy.termDetails.find(
        (t) => t.termDetailStatusDisplay === "Active"
      ) ?? policy.termDetails[0];

      // Parse coverages from the real API shape
      const compCoverage = policy.coverages.find((c) => c.name === "COMP");
      const collCoverage = policy.coverages.find((c) => c.name === "COLL");
      const bipdCoverage = policy.coverages.find((c) => c.name === "BIPD");

      // Build lienholder info
      const lienholder = vehicle.vehicleLienholders[0];
      const lienholderAddress = lienholder
        ? [
            lienholder.lienholderAddressLineOne,
            lienholder.lienholderAddressLineTwo,
            `${lienholder.lienholderAddressCity}, ${lienholder.lienholderAddressState} ${lienholder.lienholderAddressZip}`,
          ]
            .filter(Boolean)
            .join(", ")
        : undefined;

      const rawData: Record<string, unknown> = {
        policyNumber: policy.number,
        policyStatus: policy.status,
        namedInsured: policy.primaryNamedInsured.name,
        effectiveDate: activeTerm?.termDetailEffectiveDate ?? policy.effectiveDate,
        expirationDate: activeTerm?.termDetailExpirationDate,
        hasComprehensive: !!compCoverage,
        comprehensiveDeductible: compCoverage?.description,
        hasCollision: !!collCoverage,
        collisionDeductible: collCoverage?.description,
        liabilityLimit: bipdCoverage?.description,
        lienholderName: lienholder?.lienholderName,
        lienholderAddress,
        drivers: policy.drivers.map((d) => d.name).join(", "),
        vehicleVin: vehicle.vin,
        vehicleYear: vehicle.modelYear,
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
      };

      const result = this.normalizeResult(input, rawData);
      result.agentSteps = 0;
      result.durationMs = Date.now() - start;
      return result;
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      return {
        success: false,
        policyId: input.policyId,
        policyStatus: PolicyStatus.NOT_AVAILABLE,
        insuranceProvider: "Progressive",
        errorReason: err instanceof Error ? err.message : "Unknown error",
        agentSteps: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  isSessionValid(session: unknown): boolean {
    return isSessionFresh(session as ProveSession);
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
