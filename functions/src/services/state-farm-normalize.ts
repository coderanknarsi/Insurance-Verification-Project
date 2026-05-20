import {
  PolicyStatus,
  ComplianceIssue,
  DashboardStatus,
} from "../types/policy";
import type {
  CoveragePeriod,
  Coverage,
  InterestedParty,
} from "../types/policy";
import {
  computeComplianceIssues,
  computeDashboardStatus,
  type ParsedInsuranceRecord,
} from "./insurance-parser";
import type { ComplianceRules } from "../types/organization";

/**
 * Raw scraped fields the Chrome extension content-script reports back from
 * a State Farm Policy Information page. All fields are optional/best-effort
 * — the normalizer handles missing values.
 *
 * Shape intentionally mirrors `engine/src/carriers/state-farm/module.ts`
 * `normalizeResult(rawData)` so terminal-script results and extension
 * results round-trip identically.
 */
export interface StateFarmScrapedPolicy {
  policyNumber?: string;
  policyStatus?: string;
  policyOriginDate?: string;
  policyEffectiveDate?: string;
  hasCollision?: boolean | string;
  collisionDeductible?: string | number;
  hasComprehensive?: boolean | string;
  comprehensiveDeductible?: string | number;
  bodilyInjuryLimitPerAccident?: string | number;
  propertyDamageLimitPerAccident?: string | number;
  lienholderName?: string;
  lienholderAddress?: string;
  lossPaye?: string;
}

export interface StateFarmNormalized {
  parsed: ParsedInsuranceRecord;
  complianceIssues: ComplianceIssue[];
  dashboardStatus: DashboardStatus;
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
  if (val === null || val === undefined || val === "") return undefined;
  const n = Number(String(val).replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? undefined : n;
}

function asBool(val: unknown): boolean {
  return val === true || String(val).toLowerCase() === "true";
}

/**
 * Convert State Farm scraped fields into a `ParsedInsuranceRecord` and
 * compute the compliance/dashboard derivations the rest of the app reads.
 */
export function normalizeStateFarmScrape(
  scraped: StateFarmScrapedPolicy,
  rules?: ComplianceRules,
): StateFarmNormalized {
  const status = mapPolicyStatus(scraped.policyStatus);

  const coverages: Coverage[] = [];
  if (asBool(scraped.hasCollision)) {
    coverages.push({
      type: "Collision",
      deductible: parseNumber(scraped.collisionDeductible),
    });
  }
  if (asBool(scraped.hasComprehensive)) {
    coverages.push({
      type: "Comprehensive",
      deductible: parseNumber(scraped.comprehensiveDeductible),
    });
  }
  const biLimit = parseNumber(scraped.bodilyInjuryLimitPerAccident);
  const pdLimit = parseNumber(scraped.propertyDamageLimitPerAccident);
  if (biLimit != null || pdLimit != null) {
    coverages.push({ type: "Liability", limit: biLimit ?? pdLimit });
  }

  const interestedParties: InterestedParty[] = [];
  if (scraped.lienholderName) {
    interestedParties.push({
      name: String(scraped.lienholderName),
      type: "LIEN_HOLDER",
      address: scraped.lienholderAddress
        ? { addr1: String(scraped.lienholderAddress) }
        : undefined,
    });
  }

  const lossPaye = String(scraped.lossPaye ?? "").toLowerCase();
  const isLienholderListed =
    interestedParties.length > 0 && lossPaye === "yes";

  const coveragePeriod: CoveragePeriod | undefined =
    scraped.policyOriginDate && scraped.policyEffectiveDate
      ? {
          startDate: String(scraped.policyOriginDate),
          endDate: String(scraped.policyEffectiveDate),
        }
      : undefined;

  const parsed: ParsedInsuranceRecord = {
    status,
    policyNumber: scraped.policyNumber
      ? String(scraped.policyNumber)
      : undefined,
    policyTypes: ["AUTO"],
    coveragePeriod,
    coverages,
    coverageItems: [],
    interestedParties,
    isLienholderListed,
    insuranceProvider: "State Farm",
    insuranceProviderDetail: { name: "State Farm" },
    cancelledDate: undefined,
    pendingCancelDate: undefined,
    premiumAmount: undefined,
    paymentFrequency: undefined,
    drivers: [],
    vehicleRemovedFromPolicy: false,
  };

  const complianceIssues = computeComplianceIssues(parsed, rules);
  const dashboardStatus = computeDashboardStatus(
    status,
    isLienholderListed,
    coveragePeriod,
    complianceIssues,
  );

  return { parsed, complianceIssues, dashboardStatus };
}
