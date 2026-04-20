import { Firestore, FieldValue } from "@google-cloud/firestore";
import type { VerificationResult } from "../types/verification.js";
import { PolicyStatus } from "../types/policy.js";

let db: Firestore | null = null;

function getDb(): Firestore {
  if (!db) {
    db = new Firestore({
      projectId: process.env.GCP_PROJECT_ID ?? "insurance-track-os",
    });
  }
  return db;
}

/**
 * Writes a verification result back to Firestore, updating:
 *   1. The policy document
 *   2. The vehicle document (lastVerifiedAt)
 *   3. A dataFeedRun sub-log
 */
export async function writeResult(
  result: VerificationResult,
  runId: string
): Promise<void> {
  const batch = getDb().batch();
  const policyRef = getDb().collection("policies").doc(result.policyId);

  // 1. Update policy document
  const policyUpdate: Record<string, unknown> = {
    policyStatus: result.policyStatus,
    insuranceProvider: result.insuranceProvider,
    verificationSource: "data-feed",
    lastVerifiedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (result.policyNumber) policyUpdate.policyNumber = result.policyNumber;
  if (result.coveragePeriod) policyUpdate.coveragePeriod = result.coveragePeriod;
  if (result.coverages) policyUpdate.coverages = result.coverages;
  if (result.interestedParties) policyUpdate.interestedParties = result.interestedParties;
  if (result.isLienholderListed !== undefined) {
    policyUpdate.isLienholderListed = result.isLienholderListed;
  }
  if (result.drivers) policyUpdate.drivers = result.drivers;

  // Compute compliance from the result
  const complianceIssues = computeComplianceIssues(result);
  const dashboardStatus = computeDashboardStatus(result.policyStatus, complianceIssues);
  policyUpdate.complianceIssues = complianceIssues;
  policyUpdate.dashboardStatus = dashboardStatus;

  batch.update(policyRef, policyUpdate);

  // 2. Log the verification run result
  const logRef = getDb()
    .collection("dataFeedRuns")
    .doc(runId)
    .collection("results")
    .doc(result.policyId);

  batch.set(logRef, {
    success: result.success,
    policyStatus: result.policyStatus,
    agentSteps: result.agentSteps,
    durationMs: result.durationMs,
    errorReason: result.errorReason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Compute compliance issues from a VerificationResult.
 * Mirrors the logic in functions/src/services/insurance-parser.ts
 * but works with the VerificationResult type directly.
 */
function computeComplianceIssues(result: VerificationResult): string[] {
  const issues: Set<string> = new Set();

  // Terminal statuses
  if (result.policyStatus === PolicyStatus.CANCELLED) issues.add("POLICY_CANCELLED");
  if (result.policyStatus === PolicyStatus.EXPIRED) issues.add("POLICY_EXPIRED");
  if (result.policyStatus === PolicyStatus.PENDING_CANCELLATION) issues.add("PENDING_CANCELLATION");
  if (result.policyStatus === PolicyStatus.UNVERIFIED) issues.add("UNVERIFIED");
  if (result.policyStatus === PolicyStatus.NOT_AVAILABLE) issues.add("UNVERIFIED");

  // Lienholder check
  if (result.isLienholderListed === false) issues.add("MISSING_LIENHOLDER");

  // Coverage checks
  if (result.coverages) {
    const types = result.coverages.map((c) => c.type.toLowerCase());
    if (!types.some((t) => t.includes("comprehensive"))) issues.add("NO_COMPREHENSIVE");
    if (!types.some((t) => t.includes("collision"))) issues.add("NO_COLLISION");
  } else if (result.success) {
    // Data was retrieved but no coverages found
    issues.add("NO_COMPREHENSIVE");
    issues.add("NO_COLLISION");
  }

  // Expiration check
  if (result.coveragePeriod?.endDate) {
    const end = new Date(result.coveragePeriod.endDate);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry <= 0) {
      issues.add("COVERAGE_EXPIRED");
    } else if (daysUntilExpiry <= 15) {
      issues.add("EXPIRING_SOON");
    }
  }

  return Array.from(issues);
}

/**
 * Map compliance issues to a dashboard stoplight status.
 * Mirrors functions/src/services/insurance-parser.ts logic.
 */
function computeDashboardStatus(
  policyStatus: PolicyStatus,
  complianceIssues: string[]
): string {
  const redIssues = new Set([
    "POLICY_CANCELLED",
    "POLICY_EXPIRED",
    "MISSING_LIENHOLDER",
    "NO_COMPREHENSIVE",
    "NO_COLLISION",
    "UNVERIFIED",
    "COVERAGE_EXPIRED",
    "VEHICLE_REMOVED",
  ]);

  if (complianceIssues.some((i) => redIssues.has(i))) return "RED";
  if (complianceIssues.length > 0) return "YELLOW";
  if (policyStatus === PolicyStatus.ACTIVE) return "GREEN";
  return "YELLOW";
}
