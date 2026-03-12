import { PolicyStatus, DashboardStatus } from "../types/policy";
import type { CoveragePeriod, Coverage } from "../types/policy";

interface ParsedInsuranceRecord {
  status: PolicyStatus;
  policyNumber: string | undefined;
  policyTypes: string[];
  coveragePeriod: CoveragePeriod | undefined;
  coverages: Coverage[];
  isLienholderListed: boolean;
  insuranceProvider: string | undefined;
}

/**
 * Maps MeasureOne status string to our PolicyStatus enum.
 * Unknown statuses default to NOT_AVAILABLE.
 */
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

/**
 * Parses a MeasureOne M1_INSURANCE_RECORD into our policy fields.
 */
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
    coveragePeriod = {
      startDate: cp.start_date,
      endDate: cp.end_date,
    };
  }

  const coverages: Coverage[] = Array.isArray(rec.coverages)
    ? (rec.coverages as Record<string, unknown>[]).map((c) => ({
        type: (c.type as string) ?? "UNKNOWN",
        limit: c.limit as number | undefined,
        deductible: c.deductible as number | undefined,
      }))
    : [];

  const policyHolders = Array.isArray(rec.policy_holders)
    ? (rec.policy_holders as Record<string, unknown>[])
    : [];
  const isLienholderListed = policyHolders.some(
    (ph) => ph.type === "LIEN_HOLDER"
  );

  const insuranceProvider =
    (rec.insurance_provider as string) ??
    (rec.insurer_name as string) ??
    undefined;

  return {
    status,
    policyNumber,
    policyTypes,
    coveragePeriod,
    coverages,
    isLienholderListed,
    insuranceProvider,
  };
}

/**
 * Computes dashboard stoplight status.
 * GREEN: ACTIVE + lienholder listed
 * YELLOW: PENDING_EXPIRATION or expiring within 15 days
 * RED: everything else
 */
export function computeDashboardStatus(
  status: PolicyStatus,
  isLienholderListed: boolean,
  coveragePeriod?: CoveragePeriod
): DashboardStatus {
  if (status === PolicyStatus.ACTIVE && isLienholderListed) {
    // Check if expiring within 15 days
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

  if (status === PolicyStatus.PENDING_EXPIRATION) {
    return DashboardStatus.YELLOW;
  }

  if (status === PolicyStatus.PENDING_ACTIVATION) {
    return DashboardStatus.YELLOW;
  }

  return DashboardStatus.RED;
}
