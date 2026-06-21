import type { PolicySnapshot } from "../types/policy-change";
import { extractCoverage } from "./coverage-extract";

interface PolicyLike {
  status?: string;
  insuranceProvider?: string;
  policyNumber?: string;
  coveragePeriod?: { startDate?: string; endDate?: string };
  isLienholderListed?: boolean;
  dashboardStatus?: string;
  coverageItems?: unknown;
  coverages?: unknown;
}

function normalizeCarrier(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.trim().toLowerCase().replace(/\s+/g, "_") || null;
}

function toMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Reduce a policy document to the minimal comparable snapshot consumed by
 * diffPolicySnapshot(). Pure: no Firestore, deterministic.
 */
export function extractSnapshot(policy: PolicyLike): PolicySnapshot {
  const cov = extractCoverage(policy as never);
  return {
    status: policy.status ?? "NOT_AVAILABLE",
    insuranceProvider: normalizeCarrier(policy.insuranceProvider),
    policyNumber: policy.policyNumber ?? null,
    hasComprehensive: cov.hasComprehensive,
    hasCollision: cov.hasCollision,
    comprehensiveDeductible: cov.comprehensiveDeductible,
    collisionDeductible: cov.collisionDeductible,
    expirationMs: toMs(policy.coveragePeriod?.endDate),
    isLienholderListed: policy.isLienholderListed ?? false,
    dashboardStatus: policy.dashboardStatus ?? "GREEN",
  };
}
