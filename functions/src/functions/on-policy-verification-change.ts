import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { DEMO_ORG_ID } from "../constants";
import { extractSnapshot } from "../services/policy-snapshot";
import { diffPolicySnapshot } from "../services/policy-diff";
import { AuditEntityType, AuditAction } from "../types/audit";
import { dispatchChangeNotifications } from "../services/change-notifications";

/**
 * Single chokepoint for policy-change detection. Fires on EVERY write to a
 * policy doc (operator sweep path AND Cloud Run engine path), but only acts
 * when a verification actually advanced — guarded by lastVerifiedAt /
 * lastVerificationAttempt moving forward. This excludes cadence-job writes
 * (which only touch lapseDetectedAt / notification anchors), so we never
 * loop and never diff a non-verification edit.
 *
 * Writes: policyChanges history docs + auditLog dashboardStatus transitions.
 * Dispatches change-driven borrower/lender notifications (Chunk 3).
 */
export const onPolicyVerificationChange = onDocumentUpdated(
  {
    document: "policies/{policyId}",
    region: "us-central1",
    memory: "256MiB",
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (after.organizationId === DEMO_ORG_ID) return;

    // Guard: only proceed when a verification advanced.
    const beforeVerifiedMs = tsMs(before.lastVerifiedAt);
    const afterVerifiedMs = tsMs(after.lastVerifiedAt);
    const beforeAttemptMs = tsMs(before.lastVerificationAttempt);
    const afterAttemptMs = tsMs(after.lastVerificationAttempt);
    const verificationAdvanced =
      afterVerifiedMs > beforeVerifiedMs || afterAttemptMs > beforeAttemptMs;
    if (!verificationAdvanced) return;

    const policyId = event.params.policyId;
    const orgId = after.organizationId as string;
    const borrowerId = (after.borrowerId as string) ?? "";

    // Baseline: persisted lastSnapshot if present, else the "before" doc.
    const beforeSnap = after.lastSnapshot ?? extractSnapshot(before);
    const afterSnap = extractSnapshot(after);
    const rawChanges = diffPolicySnapshot(beforeSnap, afterSnap);

    const batch = db.batch();
    const now = FieldValue.serverTimestamp();

    // Persist the new snapshot baseline for next time. Cast to never — the
    // policies collection has a typed converter but we only patch one field.
    batch.update(event.data!.after.ref, { lastSnapshot: afterSnap } as never);

    // dashboardStatus transition audit (every transition, not just overrides).
    if (beforeSnap.dashboardStatus !== afterSnap.dashboardStatus) {
      const auditRef = collections.auditLog.doc();
      batch.set(auditRef, {
        organizationId: orgId,
        entityType: AuditEntityType.POLICY,
        entityId: policyId,
        action: AuditAction.STATUS_CHANGED,
        previousValue: { dashboardStatus: beforeSnap.dashboardStatus },
        newValue: { dashboardStatus: afterSnap.dashboardStatus },
        performedBy: "verification-system",
        timestamp: now,
      } as never);
    }

    const persistedChangeIds: string[] = [];
    for (const rc of rawChanges) {
      const ref = collections.policyChanges.doc();
      persistedChangeIds.push(ref.id);
      batch.set(ref, {
        organizationId: orgId,
        borrowerId,
        policyId,
        type: rc.type,
        severity: rc.severity,
        summary: rc.summary,
        previousValue: rc.previousValue,
        newValue: rc.newValue,
        createdAt: now,
      });
    }

    await batch.commit();

    if (rawChanges.length > 0) {
      logger.info("policy changes detected", {
        policyId,
        orgId,
        changes: rawChanges.map((c) => c.type),
      });
      // Dispatch borrower/lender notifications (Chunk 3). Errors are caught so
      // a notification failure never blocks change persistence.
      await dispatchChangeNotifications({
        organizationId: orgId,
        borrowerId,
        policyId,
        changeIds: persistedChangeIds,
        changes: rawChanges,
      }).catch((err) =>
        logger.error("change notification dispatch failed", { policyId, err }),
      );
    }
  },
);

function tsMs(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (
    value &&
    typeof (value as { toMillis?: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}
