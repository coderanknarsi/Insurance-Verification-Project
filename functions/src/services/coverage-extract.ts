/**
 * Pure helpers to pull comprehensive/collision presence + deductibles out of a
 * policy regardless of whether it stores rich `coverageItems` or legacy
 * `coverages`. No Firestore access.
 */

interface CoverageDeductibleLike {
  amount?: number;
  text?: string;
}
interface CoverageItemLike {
  type?: string;
  deductibles?: CoverageDeductibleLike[];
}
interface LegacyCoverageLike {
  type?: string;
  deductible?: number;
}
interface PolicyLike {
  coverageItems?: CoverageItemLike[];
  coverages?: LegacyCoverageLike[];
}

export interface ExtractedCoverage {
  hasComprehensive: boolean;
  hasCollision: boolean;
  comprehensiveDeductible: number | null;
  collisionDeductible: number | null;
}

function matches(type: string | undefined, needle: string): boolean {
  return (type ?? "").toLowerCase().includes(needle);
}

function firstDeductible(item: CoverageItemLike): number | null {
  for (const d of item.deductibles ?? []) {
    if (typeof d.amount === "number") return d.amount;
  }
  return null;
}

export function extractCoverage(policy: PolicyLike): ExtractedCoverage {
  const result: ExtractedCoverage = {
    hasComprehensive: false,
    hasCollision: false,
    comprehensiveDeductible: null,
    collisionDeductible: null,
  };

  for (const item of policy.coverageItems ?? []) {
    if (matches(item.type, "comprehensive")) {
      result.hasComprehensive = true;
      result.comprehensiveDeductible = firstDeductible(item);
    } else if (matches(item.type, "collision")) {
      result.hasCollision = true;
      result.collisionDeductible = firstDeductible(item);
    }
  }

  // Legacy fallback only if rich items did not establish the coverage.
  for (const cov of policy.coverages ?? []) {
    if (matches(cov.type, "comprehensive") && !result.hasComprehensive) {
      result.hasComprehensive = true;
      result.comprehensiveDeductible =
        typeof cov.deductible === "number" ? cov.deductible : null;
    } else if (matches(cov.type, "collision") && !result.hasCollision) {
      result.hasCollision = true;
      result.collisionDeductible =
        typeof cov.deductible === "number" ? cov.deductible : null;
    }
  }

  return result;
}
