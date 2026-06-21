import { Timestamp } from "firebase-admin/firestore";

/**
 * Typed lifecycle changes detected by diffing two policy verification
 * snapshots. Each maps to a borrower/lender communication decision.
 */
export enum PolicyChangeType {
  CARRIER_CHANGED = "CARRIER_CHANGED",
  COVERAGE_DOWNGRADED = "COVERAGE_DOWNGRADED", // comprehensive and/or collision dropped
  DEDUCTIBLE_INCREASED = "DEDUCTIBLE_INCREASED",
  EXPIRATION_MOVED_UP = "EXPIRATION_MOVED_UP", // term shortened / cancels earlier
  POLICY_LAPSED = "POLICY_LAPSED", // ACTIVE -> CANCELLED/EXPIRED/RESCINDED
  POLICY_REINSTATED = "POLICY_REINSTATED", // lapsed -> ACTIVE
  LIENHOLDER_REMOVED = "LIENHOLDER_REMOVED",
  LIENHOLDER_ADDED = "LIENHOLDER_ADDED",
  STATUS_CHANGED = "STATUS_CHANGED", // catch-all status transition (audit only)
}

export type ChangeSeverity = "info" | "warning" | "critical";

/**
 * The minimal, comparable shape of a policy's verified coverage. Produced by
 * extractSnapshot(); compared by diffPolicySnapshot().
 */
export interface PolicySnapshot {
  status: string; // PolicyStatus
  insuranceProvider: string | null; // normalized carrier id, lowercased
  policyNumber: string | null;
  hasComprehensive: boolean;
  hasCollision: boolean;
  comprehensiveDeductible: number | null;
  collisionDeductible: number | null;
  expirationMs: number | null; // coveragePeriod.endDate as epoch ms
  isLienholderListed: boolean;
  dashboardStatus: string; // GREEN | YELLOW | RED
}

export interface PolicyChange {
  id?: string;
  organizationId: string;
  borrowerId: string;
  policyId: string;
  type: PolicyChangeType;
  severity: ChangeSeverity;
  /** Human-readable, e.g. "Comprehensive deductible increased $300 → $1,500". */
  summary: string;
  previousValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
  /** Set once a borrower/lender notification is dispatched for this change. */
  notifiedAt?: Timestamp;
  createdAt: Timestamp;
}
