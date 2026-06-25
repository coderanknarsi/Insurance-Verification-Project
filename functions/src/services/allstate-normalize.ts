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
import { toIsoDate } from "./state-farm-normalize";

/**
 * Raw scraped fields the operator's Allstate AXCiS adapter reports back from a
 * "Lienholder Service Center" coverage response page (Response.aspx). All
 * fields are optional/best-effort — the normalizer tolerates missing values.
 *
 * Shape mirrors `operator/src/carriers/allstate/adapter.ts` `AllstateScraped`
 * so operator results round-trip into the same `ParsedInsuranceRecord` shape
 * the rest of the app reads.
 */
export interface AllstateScrapedPolicy {
  policyNumber?: string;
  insuredName?: string;
  companyName?: string;
  policyEffectiveDate?: string;
  policyExpirationDate?: string;
  policyStatus?: string;
  vin?: string;
  modelName?: string;
  modelYear?: string;
  bodilyInjuryLimit?: string | number;
  propertyDamageLimit?: string | number;
  hasCollision?: boolean | string;
  collisionDeductible?: string | number;
  hasComprehensive?: boolean | string;
  comprehensiveDeductible?: string | number;
  cancelDate?: string;
  reinstateDate?: string;
  lienholderName?: string;
  lienholderAddress?: string;
  lienholderCityStateZip?: string;
  loanExpiration?: string;
  vehicleAdded?: string;
}

export interface AllstateNormalized {
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
  if (upper.includes("REINSTATE")) return PolicyStatus.ACTIVE;
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

function cleanString(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = String(raw).replace(/\s+/g, " ").trim();
  if (!t || /^n\/?a$/i.test(t)) return undefined;
  return t;
}

/**
 * Parse "ATLANTA, GA 30342" into its parts. Falls back gracefully when the
 * format varies (e.g. missing comma or ZIP).
 */
function parseCityStateZip(
  raw: string | undefined,
): { city?: string; state?: string; zipcode?: string } {
  const s = cleanString(raw);
  if (!s) return {};
  // "CITY, ST 12345" or "CITY, ST 12345-6789"
  const m = s.match(/^(.*?),?\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) {
    return { city: m[1].trim() || undefined, state: m[2].toUpperCase(), zipcode: m[3] };
  }
  const m2 = s.match(/^(.*),\s*([A-Za-z]{2})$/);
  if (m2) {
    return { city: m2[1].trim() || undefined, state: m2[2].toUpperCase() };
  }
  return { city: s };
}

/**
 * Convert Allstate AXCiS scraped fields into a `ParsedInsuranceRecord` and
 * compute the compliance/dashboard derivations the rest of the app reads.
 *
 * Unlike State Farm's B2B page, the AXCiS response DOES expose a policy term
 * end date ("Policy Period: 06/03/2026 - 12/03/2026"), comprehensive/collision
 * deductibles, and the lienholder (LPC) block directly, so those flow through.
 */
export function normalizeAllstateScrape(
  scraped: AllstateScrapedPolicy,
  rules?: ComplianceRules,
): AllstateNormalized {
  const status = mapPolicyStatus(scraped.policyStatus);

  const coverages: Coverage[] = [];
  if (asBool(scraped.hasCollision) || scraped.collisionDeductible != null) {
    coverages.push({
      type: "Collision",
      deductible: parseNumber(scraped.collisionDeductible),
    });
  }
  if (asBool(scraped.hasComprehensive) || scraped.comprehensiveDeductible != null) {
    coverages.push({
      type: "Comprehensive",
      deductible: parseNumber(scraped.comprehensiveDeductible),
    });
  }
  const biLimit = parseNumber(scraped.bodilyInjuryLimit);
  const pdLimit = parseNumber(scraped.propertyDamageLimit);
  if (biLimit != null || pdLimit != null) {
    coverages.push({ type: "Liability", limit: biLimit ?? pdLimit });
  }

  const interestedParties: InterestedParty[] = [];
  const lienholderName = cleanString(scraped.lienholderName);
  if (lienholderName) {
    const csz = parseCityStateZip(scraped.lienholderCityStateZip);
    const addr1 = cleanString(scraped.lienholderAddress);
    const hasAddress = !!(addr1 || csz.city || csz.state || csz.zipcode);
    interestedParties.push({
      name: lienholderName,
      type: "LIEN_HOLDER",
      address: hasAddress
        ? {
            addr1,
            city: csz.city,
            state: csz.state,
            zipcode: csz.zipcode,
          }
        : undefined,
    });
  }

  // For AXCiS the presence of a listed LPC (Lienholder/Loss-Payee/Creditor) on
  // the policy IS the lienholder listing — there is no separate yes/no flag.
  const isLienholderListed = interestedParties.length > 0;

  const startDate = toIsoDate(scraped.policyEffectiveDate);
  const endDate = toIsoDate(scraped.policyExpirationDate);
  const coveragePeriod: CoveragePeriod | undefined = startDate
    ? { startDate, endDate }
    : undefined;

  const cancelledDate =
    status === PolicyStatus.CANCELLED
      ? toIsoDate(scraped.cancelDate)
      : undefined;

  const parsed: ParsedInsuranceRecord = {
    status,
    policyNumber: cleanString(scraped.policyNumber),
    policyTypes: ["AUTO"],
    coveragePeriod,
    coverages,
    coverageItems: [],
    interestedParties,
    isLienholderListed,
    insuranceProvider: "Allstate",
    insuranceProviderDetail: {
      name: cleanString(scraped.companyName) ?? "Allstate",
    },
    cancelledDate,
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
