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
 * The scraper occasionally captures the whole "Policy Details" block in the
 * policy-number field (e.g. "0456960-SFP-15\n\nPolicy Origin Date\n02/28/2026
 * ..."). Keep only the first line and trim trailing label noise so the stored
 * policy number is just the identifier (e.g. "0456960-SFP-15").
 */
function cleanPolicyNumber(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const firstLine = String(raw).split(/[\r\n\t]/)[0]?.trim();
  return firstLine || undefined;
}

/**
 * Normalize a date string to `YYYY-MM-DD`. The portal (and OCR) return dates in
 * a variety of human formats — most commonly `MM/DD/YYYY` (e.g. "02/28/2026").
 * The frontend parses dates strictly as `new Date("YYYY-MM-DD" + "T00:00:00")`,
 * so any other format renders as "Invalid Date". Returns undefined if the input
 * can't be parsed into a real calendar date.
 */
export function toIsoDate(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;

  // Already ISO (YYYY-MM-DD, optionally with time) — keep the date part.
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m}-${d}`;
  }

  // MM/DD/YYYY or M/D/YYYY (also accepts '-' or '.' separators).
  const usMatch = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (usMatch) {
    const mm = usMatch[1].padStart(2, "0");
    const dd = usMatch[2].padStart(2, "0");
    const yyyy = usMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // Fallback: let Date parse textual forms like "Feb 28, 2026".
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return undefined;
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

  // State Farm's B2B Policy Information page reports the term START via
  // "Policy Effective Date" (and an earlier "Policy Origin Date") but does NOT
  // expose a term EXPIRATION date. Do not fabricate an endDate from the
  // effective date — that produced a bogus past endDate and a false
  // "Coverage Expired" flag. Policy currency is driven by `status` instead.
  const startDate = toIsoDate(scraped.policyEffectiveDate || scraped.policyOriginDate);
  const coveragePeriod: CoveragePeriod | undefined = startDate
    ? { startDate }
    : undefined;

  const parsed: ParsedInsuranceRecord = {
    status,
    policyNumber: cleanPolicyNumber(scraped.policyNumber),
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

  const rawComplianceIssues = computeComplianceIssues(parsed, rules);
  // State Farm's B2B "Insurance Inquiry" Policy Information page only lists
  // liability (Coverage A: Bodily Injury / Property Damage). It structurally
  // does NOT report comprehensive or collision, so their absence here is
  // "unknown", not "missing" — flagging it would turn every State Farm policy
  // RED. Drop those two issues rather than asserting a coverage gap we can't see.
  const complianceIssues = rawComplianceIssues.filter(
    (issue) =>
      issue !== ComplianceIssue.NO_COMPREHENSIVE &&
      issue !== ComplianceIssue.NO_COLLISION,
  );
  const dashboardStatus = computeDashboardStatus(
    status,
    isLienholderListed,
    coveragePeriod,
    complianceIssues,
  );

  return { parsed, complianceIssues, dashboardStatus };
}
