import { PolicyChangeType, type ChangeSeverity } from "../types/policy-change";
import type { PolicySnapshot } from "../types/policy-change";

/** Bare change shape returned by the pure diff (no ids/timestamps yet). */
export interface RawPolicyChange {
  type: PolicyChangeType;
  severity: ChangeSeverity;
  summary: string;
  previousValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
}

const LAPSED = new Set(["CANCELLED", "EXPIRED", "RESCINDED"]);

function money(n: number | null): string {
  return n === null ? "none" : `$${n.toLocaleString("en-US")}`;
}

/**
 * Compare two snapshots and return the typed list of lifecycle changes.
 * Pure: no Firestore, no time, deterministic. Only flags changes that matter
 * to a lienholder (increases/downgrades/lapses), never improvements.
 */
export function diffPolicySnapshot(
  before: PolicySnapshot,
  after: PolicySnapshot,
): RawPolicyChange[] {
  const changes: RawPolicyChange[] = [];

  // ── Lapse / reinstatement (status transitions) ──
  const wasLapsed = LAPSED.has(before.status);
  const isLapsed = LAPSED.has(after.status);
  if (!wasLapsed && isLapsed) {
    changes.push({
      type: PolicyChangeType.POLICY_LAPSED,
      severity: "critical",
      summary: `Policy ${before.status} → ${after.status} (coverage lapsed)`,
      previousValue: before.status,
      newValue: after.status,
    });
  } else if (wasLapsed && after.status === "ACTIVE") {
    changes.push({
      type: PolicyChangeType.POLICY_REINSTATED,
      severity: "info",
      summary: "Coverage reinstated (policy active again)",
      previousValue: before.status,
      newValue: after.status,
    });
  }

  // ── Carrier switch ──
  if (
    before.insuranceProvider &&
    after.insuranceProvider &&
    before.insuranceProvider !== after.insuranceProvider
  ) {
    changes.push({
      type: PolicyChangeType.CARRIER_CHANGED,
      severity: "warning",
      summary: `Carrier changed: ${before.insuranceProvider} → ${after.insuranceProvider}`,
      previousValue: before.insuranceProvider,
      newValue: after.insuranceProvider,
    });
  }

  // ── Coverage downgrade (comprehensive or collision dropped) ──
  const comprehensiveDropped = before.hasComprehensive && !after.hasComprehensive;
  const collisionDropped = before.hasCollision && !after.hasCollision;
  if (comprehensiveDropped || collisionDropped) {
    const lost = [
      comprehensiveDropped ? "comprehensive" : null,
      collisionDropped ? "collision" : null,
    ]
      .filter(Boolean)
      .join(" + ");
    changes.push({
      type: PolicyChangeType.COVERAGE_DOWNGRADED,
      severity: "critical",
      summary: `Physical-damage coverage dropped: ${lost} removed`,
      previousValue: `comp:${before.hasComprehensive} coll:${before.hasCollision}`,
      newValue: `comp:${after.hasComprehensive} coll:${after.hasCollision}`,
    });
  }

  // ── Deductible increases (each line independently) ──
  for (const [label, b, a] of [
    ["Comprehensive", before.comprehensiveDeductible, after.comprehensiveDeductible],
    ["Collision", before.collisionDeductible, after.collisionDeductible],
  ] as const) {
    if (b !== null && a !== null && a > b) {
      changes.push({
        type: PolicyChangeType.DEDUCTIBLE_INCREASED,
        severity: "warning",
        summary: `${label} deductible increased ${money(b)} → ${money(a)}`,
        previousValue: b,
        newValue: a,
      });
    }
  }

  // ── Expiration moved earlier ──
  if (
    before.expirationMs !== null &&
    after.expirationMs !== null &&
    after.expirationMs < before.expirationMs
  ) {
    changes.push({
      type: PolicyChangeType.EXPIRATION_MOVED_UP,
      severity: "warning",
      summary: `Policy expiration moved earlier: ${new Date(before.expirationMs)
        .toISOString()
        .slice(0, 10)} → ${new Date(after.expirationMs).toISOString().slice(0, 10)}`,
      previousValue: new Date(before.expirationMs).toISOString().slice(0, 10),
      newValue: new Date(after.expirationMs).toISOString().slice(0, 10),
    });
  }

  // ── Lienholder add/remove ──
  if (before.isLienholderListed && !after.isLienholderListed) {
    changes.push({
      type: PolicyChangeType.LIENHOLDER_REMOVED,
      severity: "critical",
      summary: "Lienholder removed from policy",
      previousValue: true,
      newValue: false,
    });
  } else if (!before.isLienholderListed && after.isLienholderListed) {
    changes.push({
      type: PolicyChangeType.LIENHOLDER_ADDED,
      severity: "info",
      summary: "Lienholder added to policy",
      previousValue: false,
      newValue: true,
    });
  }

  return changes;
}
