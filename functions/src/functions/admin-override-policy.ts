import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireSuperAdmin } from "../middleware/auth";
import { AuditAction, AuditEntityType } from "../types/audit";

const ALLOWED_STATUSES = new Set(["GREEN", "YELLOW", "RED"]);

export interface OverrideInput {
  dashboardStatus: string;
  note?: string;
}

/** Pure: builds the Firestore update for a manual override. Throws on bad status. */
export function buildOverrideUpdate(
  input: OverrideInput,
  adminEmail: string,
): Record<string, unknown> {
  if (!ALLOWED_STATUSES.has(input.dashboardStatus)) {
    throw new Error(`Invalid dashboardStatus: ${input.dashboardStatus}`);
  }
  return {
    dashboardStatus: input.dashboardStatus,
    verificationSource: "manual-override",
    overriddenBy: adminEmail,
    overrideNote: input.note ?? null,
    lastVerifiedAt: FieldValue.serverTimestamp(),
    lastVerificationError: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export const adminOverridePolicyStatus = onCall(
  { region: "us-central1" },
  async (request) => {
    requireSuperAdmin(request);
    const adminEmail = request.auth?.token?.email ?? "super-admin";

    const { policyId, organizationId, dashboardStatus, note } = request.data as {
      policyId?: string;
      organizationId?: string;
      dashboardStatus?: string;
      note?: string;
    };
    if (!policyId || !organizationId || !dashboardStatus) {
      throw new HttpsError(
        "invalid-argument",
        "policyId, organizationId and dashboardStatus are required.",
      );
    }

    const ref = collections.policies.doc(policyId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.organizationId !== organizationId) {
      throw new HttpsError(
        "not-found",
        "Policy not found in this organization.",
      );
    }
    const previousStatus = snap.data()?.dashboardStatus ?? null;

    let update: Record<string, unknown>;
    try {
      update = buildOverrideUpdate({ dashboardStatus, note }, adminEmail);
    } catch (e) {
      throw new HttpsError("invalid-argument", (e as Error).message);
    }

    await ref.update(update);

    // Audit trail.
    await collections.auditLog.add({
      organizationId,
      entityType: AuditEntityType.POLICY,
      entityId: policyId,
      action: AuditAction.STATUS_CHANGED,
      previousValue: { dashboardStatus: previousStatus },
      newValue: { dashboardStatus, note: note ?? null, source: "manual-override" },
      performedBy: adminEmail,
      timestamp: FieldValue.serverTimestamp(),
    } as never);

    return { ok: true };
  },
);
