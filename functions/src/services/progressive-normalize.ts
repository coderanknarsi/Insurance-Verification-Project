import {
  PolicyStatus,
  ComplianceIssue,
  DashboardStatus,
} from "../types/policy";
import type { CoveragePeriod, Coverage, InterestedParty } from "../types/policy";
import {
  computeComplianceIssues,
  computeDashboardStatus,
  type ParsedInsuranceRecord,
} from "./insurance-parser";
import { toIsoDate } from "./state-farm-normalize";
import type { ComplianceRules } from "../types/organization";

/**
 * Raw scraped fields the AutoLien Operator reports back from a Progressive
 * PROVE policy lookup. The operator's Progressive adapter calls the PROVE JSON
 * API (`POST /ProveAPI/v1/vehicles`) and maps the response into this shape.
 *
 * Unlike State Farm, PROVE exposes BOTH the term effective and expiration
 * dates, so `coveragePeriod` can carry a real endDate.
 *
 * All fields are optional/best-effort — the normalizer handles missing values.
 */
export interface ProgressiveScrapedPolicy {
  policyNumber?: string;
  policyStatus?: string; // e.g. "Active"
  effectiveDate?: string; // term effective, e.g. "6/5/2026"
  expirationDate?: string; // term expiration, e.g. "12/5/2026"
  primaryNamedInsured?: string;
  /** Raw BIPD coverage description, e.g. "$100,000 each person/$300,000 each accident/$100,000 each accident" */
  bipdDescription?: string;
  hasComprehensive?: boolean | string;
  comprehensiveDeductible?: string | number;
  hasCollision?: boolean | string;
  collisionDeductible?: string | number;
  lienholderName?: string;
  lienholderAddress?: string;
  drivers?: string[];
  vin?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
}

export interface ProgressiveNormalized {
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
 * Parse the PROVE BIPD description into bodily-injury (per accident) and
 * property-damage limits. Format observed:
 *   "$100,000 each person/$300,000 each accident/$100,000 each accident"
 * The three segments are: BI per person / BI per accident / PD per accident.
 */
function parseBipd(description: string | undefined): {
  biPerAccident?: number;
  pdPerAccident?: number;
} {
  if (!description) return {};
  const parts = description.split("/").map((s) => s.trim());
  // Segments containing "accident": [1] = BI per accident, [2] = PD per accident.
  const accidentSegs = parts.filter((p) => /accident/i.test(p));
  const biPerAccident = accidentSegs[0] ? parseNumber(accidentSegs[0]) : undefined;
  const pdPerAccident = accidentSegs[1] ? parseNumber(accidentSegs[1]) : undefined;
  return { biPerAccident, pdPerAccident };
}

/**
 * Convert Progressive PROVE scraped fields into a `ParsedInsuranceRecord` and
 * compute the compliance/dashboard derivations the rest of the app reads.
 * Mirrors `normalizeStateFarmScrape` so operator results round-trip identically.
 */
export function normalizeProgressiveScrape(
  scraped: ProgressiveScrapedPolicy,
  rules?: ComplianceRules,
): ProgressiveNormalized {
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
  const { biPerAccident, pdPerAccident } = parseBipd(scraped.bipdDescription);
  if (biPerAccident != null || pdPerAccident != null) {
    coverages.push({ type: "Liability", limit: biPerAccident ?? pdPerAccident });
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

  // PROVE lists lienholders directly on the vehicle, so presence means the
  // lienholder is recorded on the policy (no separate loss-payee flag needed).
  const isLienholderListed = interestedParties.length > 0;

  // PROVE exposes both term effective and expiration dates.
  const startDate = toIsoDate(scraped.effectiveDate);
  const endDate = toIsoDate(scraped.expirationDate);
  const coveragePeriod: CoveragePeriod | undefined = startDate
    ? { startDate, ...(endDate ? { endDate } : {}) }
    : undefined;

  const drivers = (scraped.drivers ?? [])
    .map((name) => String(name).trim())
    .filter(Boolean)
    .map((fullName) => ({ fullName }));

  const parsed: ParsedInsuranceRecord = {
    status,
    policyNumber: scraped.policyNumber
      ? String(scraped.policyNumber).trim()
      : undefined,
    policyTypes: ["AUTO"],
    coveragePeriod,
    coverages,
    coverageItems: [],
    interestedParties,
    isLienholderListed,
    insuranceProvider: "Progressive",
    insuranceProviderDetail: { name: "Progressive" },
    cancelledDate: undefined,
    pendingCancelDate: undefined,
    premiumAmount: undefined,
    paymentFrequency: undefined,
    drivers,
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
