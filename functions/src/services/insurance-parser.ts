import {
  PolicyStatus,
  DashboardStatus,
  ComplianceIssue,
} from "../types/policy";
import type {
  CoveragePeriod,
  Coverage,
  CoverageItem,
  CoverageLimit,
  CoverageDeductible,
  InterestedParty,
  InsuranceProviderDetail,
  DriverInfo,
} from "../types/policy";
import type { ComplianceRules } from "../types/organization";

export interface ParsedInsuranceRecord {
  status: PolicyStatus;
  policyNumber: string | undefined;
  policyTypes: string[];
  coveragePeriod: CoveragePeriod | undefined;
  coverages: Coverage[];
  coverageItems: CoverageItem[];
  interestedParties: InterestedParty[];
  isLienholderListed: boolean;
  insuranceProvider: string | undefined;
  insuranceProviderDetail: InsuranceProviderDetail | undefined;
  cancelledDate: string | undefined;
  pendingCancelDate: string | undefined;
  premiumAmount: { currency: string; amount: number } | undefined;
  paymentFrequency: string | undefined;
  drivers: DriverInfo[];
  vehicleRemovedFromPolicy: boolean;
}

function mapStatus(m1Status: string): PolicyStatus {
  const mapping: Record<string, PolicyStatus> = {
    ACTIVE: PolicyStatus.ACTIVE,
    EXPIRED: PolicyStatus.EXPIRED,
    PENDING_ACTIVATION: PolicyStatus.PENDING_ACTIVATION,
    PENDING_CANCELLATION: PolicyStatus.PENDING_CANCELLATION,
    PENDING_EXPIRATION: PolicyStatus.PENDING_EXPIRATION,
    CANCELLED: PolicyStatus.CANCELLED,
    UNVERIFIED: PolicyStatus.UNVERIFIED,
    RESCINDED: PolicyStatus.RESCINDED,
    NOT_AVAILABLE: PolicyStatus.NOT_AVAILABLE,
  };
  return mapping[m1Status] ?? PolicyStatus.NOT_AVAILABLE;
}

function parseCoverageItems(
  coverages: Record<string, unknown>[]
): CoverageItem[] {
  const items: CoverageItem[] = [];
  for (const cov of coverages) {
    const details = cov.details as Record<string, unknown> | undefined;
    if (!details) continue;
    const covItems = details.coverage_items as Record<string, unknown>[];
    if (!Array.isArray(covItems)) continue;
    for (const ci of covItems) {
      const rawLimits = (ci.limits ?? []) as Record<string, unknown>[];
      const limits: CoverageLimit[] = rawLimits.map((l) => {
        const val = l.value as Record<string, unknown> | string | undefined;
        if (typeof val === "object" && val !== null) {
          return {
            type: (l.type as string) ?? "",
            amount: val.amount as number | undefined,
            currency: val.currency as string | undefined,
          };
        }
        return { type: (l.type as string) ?? "", text: String(val ?? "") };
      });

      const rawDeds = (ci.deductibles ?? []) as Record<string, unknown>[];
      const deductibles: CoverageDeductible[] = rawDeds.map((d) => {
        const val = d.value as Record<string, unknown> | string | undefined;
        if (typeof val === "object" && val !== null) {
          return {
            type: (d.type as string) ?? "",
            amount: val.amount as number | undefined,
            currency: val.currency as string | undefined,
            isWaiver: (d.is_waiver as boolean) ?? false,
          };
        }
        return {
          type: (d.type as string) ?? "",
          text: String(val ?? ""),
          isWaiver: (d.is_waiver as boolean) ?? false,
        };
      });

      const premium = ci.premium_amount as Record<string, unknown> | undefined;
      items.push({
        name: (ci.name as string) ?? undefined,
        type: (ci.type as string) ?? "UNKNOWN",
        premiumAmount: premium
          ? {
              currency: (premium.currency as string) ?? "USD",
              amount: (premium.amount as number) ?? 0,
            }
          : undefined,
        limits,
        deductibles,
      });
    }
  }
  return items;
}

function parseInterestedParties(
  coverages: Record<string, unknown>[]
): InterestedParty[] {
  const parties: InterestedParty[] = [];
  const seen = new Set<string>();
  for (const cov of coverages) {
    const details = cov.details as Record<string, unknown> | undefined;
    if (!details) continue;
    const vInfo = details.vehicle_info as Record<string, unknown> | undefined;
    if (!vInfo) continue;
    const ips = vInfo.interested_parties as Record<string, unknown>[];
    if (!Array.isArray(ips)) continue;
    for (const ip of ips) {
      const name = (ip.name as string) ?? "";
      const type = (ip.type as string) ?? "";
      const key = `${name}|${type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const addr = ip.address as Record<string, string> | undefined;
      parties.push({
        name,
        type,
        address: addr
          ? {
              addr1: addr.addr1,
              addr2: addr.addr2,
              city: addr.city,
              state: addr.state,
              zipcode: addr.zipcode,
            }
          : undefined,
        phone: (ip.phone as string) ?? undefined,
        loanNumber: (ip.loan_number as string) ?? undefined,
      });
    }
  }
  return parties;
}

function parseDrivers(record: Record<string, unknown>): DriverInfo[] {
  const raw = record.drivers as Record<string, unknown>[] | undefined;
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => ({
    firstName: (d.first_name as string) ?? undefined,
    lastName: (d.last_name as string) ?? undefined,
    fullName:
      (d.full_name as string) ??
      ([d.first_name, d.last_name].filter(Boolean).join(" ") || undefined),
  }));
}

function checkVehicleRemoved(coverages: Record<string, unknown>[]): boolean {
  for (const cov of coverages) {
    const details = cov.details as Record<string, unknown> | undefined;
    if (!details) continue;
    const vInfo = details.vehicle_info as Record<string, unknown> | undefined;
    if (!vInfo) continue;
    if (vInfo.is_removed === true) return true;
  }
  return false;
}

export function parseInsuranceRecord(record: unknown): ParsedInsuranceRecord {
  const rec = record as Record<string, unknown>;

  const status = mapStatus((rec.status as string) ?? "NOT_AVAILABLE");
  const policyNumber = (rec.policy_number as string) ?? undefined;
  const policyTypes = Array.isArray(rec.policy_types)
    ? (rec.policy_types as string[])
    : [];

  let coveragePeriod: CoveragePeriod | undefined;
  const cp = rec.coverage_period as Record<string, string> | undefined;
  if (cp?.start_date && cp?.end_date) {
    coveragePeriod = { startDate: cp.start_date, endDate: cp.end_date };
  }

  const rawCoverages = Array.isArray(rec.coverages)
    ? (rec.coverages as Record<string, unknown>[])
    : [];

  const coverages: Coverage[] = rawCoverages.map((c) => ({
    type: (c.type as string) ?? "UNKNOWN",
    limit: c.limit as number | undefined,
    deductible: c.deductible as number | undefined,
  }));

  const coverageItems = parseCoverageItems(rawCoverages);
  const interestedParties = parseInterestedParties(rawCoverages);
  const vehicleRemovedFromPolicy = checkVehicleRemoved(rawCoverages);

  const policyHolders = Array.isArray(rec.policy_holders)
    ? (rec.policy_holders as Record<string, unknown>[])
    : [];
  const isLienholderListed = policyHolders.some(
    (ph) => ph.type === "LIEN_HOLDER"
  );

  // Insurance provider — extract as both string name and full detail object
  let insuranceProvider: string | undefined;
  let insuranceProviderDetail: InsuranceProviderDetail | undefined;
  const ip = rec.insurance_provider as
    | Record<string, unknown>
    | string
    | undefined;
  if (typeof ip === "string") {
    insuranceProvider = ip;
  } else if (typeof ip === "object" && ip !== null) {
    insuranceProvider = (ip.name as string) ?? undefined;
    const ipAddr = ip.address as Record<string, string> | undefined;
    insuranceProviderDetail = {
      name: (ip.name as string) ?? "",
      naicCode: (ip.naic_code as string) ?? undefined,
      phone: (ip.phone as string) ?? undefined,
      address: ipAddr
        ? {
            addr1: ipAddr.addr1,
            city: ipAddr.city,
            state: ipAddr.state,
            zipcode: ipAddr.zipcode,
          }
        : undefined,
    };
  } else {
    insuranceProvider =
      (rec.insurer_name as string) ?? undefined;
  }

  const cancelledDate = (rec.cancelled_date as string) ?? undefined;
  const pendingCancelDate = (rec.pending_cancel_date as string) ?? undefined;
  const paymentFrequency = (rec.payment_frequency as string) ?? undefined;

  let premiumAmount: { currency: string; amount: number } | undefined;
  const pa = rec.premium_amount as Record<string, unknown> | undefined;
  if (pa) {
    premiumAmount = {
      currency: (pa.currency as string) ?? "USD",
      amount: (pa.amount as number) ?? 0,
    };
  }

  const drivers = parseDrivers(rec);

  return {
    status,
    policyNumber,
    policyTypes,
    coveragePeriod,
    coverages,
    coverageItems,
    interestedParties,
    isLienholderListed,
    insuranceProvider,
    insuranceProviderDetail,
    cancelledDate,
    pendingCancelDate,
    premiumAmount,
    paymentFrequency,
    drivers,
    vehicleRemovedFromPolicy,
  };
}

/**
 * Evaluates parsed policy data against compliance rules to produce issue codes.
 */
export function computeComplianceIssues(
  parsed: ParsedInsuranceRecord,
  rules?: ComplianceRules
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const defaults: ComplianceRules = {
    requireLienholder: true,
    requireComprehensive: true,
    requireCollision: true,
    expirationWarningDays: 15,
    lapseGracePeriodDays: 5,
    autoSendReminder: false,
    reminderDaysBeforeExpiry: 10,
  };
  const r = rules ?? defaults;

  // Terminal statuses
  if (
    parsed.status === PolicyStatus.CANCELLED ||
    parsed.status === PolicyStatus.RESCINDED
  ) {
    issues.push(ComplianceIssue.POLICY_CANCELLED);
  }
  if (parsed.status === PolicyStatus.EXPIRED) {
    issues.push(ComplianceIssue.POLICY_EXPIRED);
  }
  if (parsed.status === PolicyStatus.PENDING_CANCELLATION) {
    issues.push(ComplianceIssue.PENDING_CANCELLATION);
  }
  if (parsed.status === PolicyStatus.UNVERIFIED) {
    issues.push(ComplianceIssue.UNVERIFIED);
  }

  // Vehicle removed
  if (parsed.vehicleRemovedFromPolicy) {
    issues.push(ComplianceIssue.VEHICLE_REMOVED);
  }

  // Lienholder check
  if (r.requireLienholder && !parsed.isLienholderListed) {
    issues.push(ComplianceIssue.MISSING_LIENHOLDER);
  }

  // Coverage type checks via coverageItems (detailed) falling back to coverages (simple)
  const covTypes = new Set<string>();
  for (const ci of parsed.coverageItems) {
    covTypes.add(ci.type.toUpperCase());
  }
  for (const c of parsed.coverages) {
    covTypes.add(c.type.toUpperCase());
  }

  if (
    r.requireComprehensive &&
    !covTypes.has("COMPREHENSIVE") &&
    !covTypes.has("COMP")
  ) {
    issues.push(ComplianceIssue.NO_COMPREHENSIVE);
  }
  if (
    r.requireCollision &&
    !covTypes.has("COLLISION") &&
    !covTypes.has("COLL")
  ) {
    issues.push(ComplianceIssue.NO_COLLISION);
  }

  // Deductible checks
  if (r.maxCompDeductible != null || r.maxCollisionDeductible != null) {
    for (const ci of parsed.coverageItems) {
      const t = ci.type.toUpperCase();
      for (const d of ci.deductibles) {
        if (d.amount == null) continue;
        if (
          (t === "COMPREHENSIVE" || t === "COMP") &&
          r.maxCompDeductible != null &&
          d.amount > r.maxCompDeductible
        ) {
          issues.push(ComplianceIssue.DEDUCTIBLE_TOO_HIGH);
        }
        if (
          (t === "COLLISION" || t === "COLL") &&
          r.maxCollisionDeductible != null &&
          d.amount > r.maxCollisionDeductible
        ) {
          issues.push(ComplianceIssue.DEDUCTIBLE_TOO_HIGH);
        }
      }
    }
  }

  // Expiration warning
  if (parsed.coveragePeriod?.endDate) {
    const endDate = new Date(parsed.coveragePeriod.endDate);
    const now = new Date();
    const daysUntil =
      (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntil < 0) {
      if (!issues.includes(ComplianceIssue.POLICY_EXPIRED)) {
        issues.push(ComplianceIssue.COVERAGE_EXPIRED);
      }
    } else if (daysUntil <= r.expirationWarningDays) {
      issues.push(ComplianceIssue.EXPIRING_SOON);
    }
  }

  // Deduplicate
  return [...new Set(issues)];
}

/**
 * Computes dashboard stoplight status from compliance issues.
 */
export function computeDashboardStatus(
  status: PolicyStatus,
  isLienholderListed: boolean,
  coveragePeriod?: CoveragePeriod,
  complianceIssues?: ComplianceIssue[]
): DashboardStatus {
  // If we have compliance issues, use them for the decision
  if (complianceIssues && complianceIssues.length > 0) {
    const redIssues = new Set([
      ComplianceIssue.POLICY_CANCELLED,
      ComplianceIssue.POLICY_EXPIRED,
      ComplianceIssue.COVERAGE_EXPIRED,
      ComplianceIssue.VEHICLE_REMOVED,
      ComplianceIssue.MISSING_LIENHOLDER,
      ComplianceIssue.NO_COMPREHENSIVE,
      ComplianceIssue.NO_COLLISION,
      ComplianceIssue.UNVERIFIED,
    ]);
    const hasRed = complianceIssues.some((i) => redIssues.has(i));
    if (hasRed) return DashboardStatus.RED;
    return DashboardStatus.YELLOW;
  }

  // Fallback to original logic
  if (status === PolicyStatus.ACTIVE && isLienholderListed) {
    if (coveragePeriod?.endDate) {
      const endDate = new Date(coveragePeriod.endDate);
      const now = new Date();
      const daysUntilExpiry =
        (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntilExpiry <= 15 && daysUntilExpiry > 0) {
        return DashboardStatus.YELLOW;
      }
    }
    return DashboardStatus.GREEN;
  }

  if (
    status === PolicyStatus.PENDING_EXPIRATION ||
    status === PolicyStatus.PENDING_ACTIVATION
  ) {
    return DashboardStatus.YELLOW;
  }

  return DashboardStatus.RED;
}
