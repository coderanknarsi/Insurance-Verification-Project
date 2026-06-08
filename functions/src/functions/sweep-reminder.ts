import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { requireAuth, requireRole, requireOrg, isSuperAdmin } from "../middleware/auth";
import { UserRole } from "../types/user";

/**
 * Sweep-day reminder banner.
 *
 * The weekly scheduler writes a `sweepReminders/{orgId}` doc on the org's
 * assigned sweep day. The dashboard reads it via `getSweepReminder` to show a
 * banner nudging the dealer to open the operator and click "Sweep Portfolio".
 * Running a sweep (or dismissing) acknowledges it.
 */

interface SweepReminder {
  operatorReadyCount: number;
  manualCount: number;
  carriers: string[];
  dueOn: number | null;
}

export const getSweepReminder = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request): Promise<{ reminder: SweepReminder | null }> => {
    const { user } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as { organizationId?: string } | undefined;
    if (!data?.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required");
    }
    const orgId = data.organizationId;
    if (!isSuperAdmin(request)) {
      requireOrg(user, orgId);
    }

    const snap = await db.collection("sweepReminders").doc(orgId).get();
    if (!snap.exists) return { reminder: null };

    const d = snap.data()!;
    if (d.acknowledged) return { reminder: null };

    const dueOn =
      d.dueOn && typeof d.dueOn.toMillis === "function" ? d.dueOn.toMillis() : null;

    return {
      reminder: {
        operatorReadyCount: d.operatorReadyCount ?? 0,
        manualCount: d.manualCount ?? 0,
        carriers: Array.isArray(d.carriers) ? d.carriers : [],
        dueOn,
      },
    };
  },
);

export const acknowledgeSweepReminder = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request): Promise<{ success: boolean }> => {
    const { user } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as { organizationId?: string } | undefined;
    if (!data?.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required");
    }
    const orgId = data.organizationId;
    if (!isSuperAdmin(request)) {
      requireOrg(user, orgId);
    }

    await db
      .collection("sweepReminders")
      .doc(orgId)
      .set(
        { acknowledged: true, acknowledgedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );

    return { success: true };
  },
);
