import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg, isSuperAdmin } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { AuditAction, AuditEntityType } from "../types/audit";
import { UserRole } from "../types/user";
import { ComplianceIssue, DashboardStatus, PolicyStatus } from "../types/policy";
import {
  normalizeCarrier,
  hasOperatorAdapter,
  getPolicyVerificationState,
  VerificationState,
} from "../services/verification-eligibility";

/**
 * Manual-verification worklist.
 *
 * Policies whose carrier has no real operator adapter (unsupported carriers
 * like Farmers, plus stub carriers such as GEICO/Allstate) can't be swept by
 * the operator. Dealers confirm coverage from the carrier's lienholder mailers
 * / Evidence of Insurance and mark the policy verified here.
 */

interface ManualVerificationRow {
  policyId: string;
  borrowerId: string | null;
  borrowerName: string;
  insuranceProvider: string | null;
  policyNumber: string | null;
  vin: string | null;
  vehicleLabel: string | null;
  reason: "unsupported_carrier" | "no_adapter";
  lastVerifiedAt: number | null;
}

export const getManualVerifications = onCall(
  { region: "us-central1", timeoutSeconds: 120, memory: "256MiB" },
  async (request): Promise<{ rows: ManualVerificationRow[] }> => {
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

    const policiesSnap = await collections.policies
      .where("organizationId", "==", orgId)
      .get();

    const rows: ManualVerificationRow[] = [];
    for (const policyDoc of policiesSnap.docs) {
      const p = policyDoc.data();
      const carrier = normalizeCarrier(p.insuranceProvider);
      // No carrier yet, or carrier has a real operator adapter → not manual.
      if (!carrier || hasOperatorAdapter(carrier)) continue;

      const [vehicleSnap, borrowerSnap] = await Promise.all([
        p.vehicleId ? collections.vehicles.doc(p.vehicleId).get() : Promise.resolve(null),
        p.borrowerId ? collections.borrowers.doc(p.borrowerId).get() : Promise.resolve(null),
      ]);
      const vehicle = vehicleSnap?.data();
      const borrower = borrowerSnap?.data();
      const borrowerName =
        [borrower?.firstName, borrower?.lastName].filter(Boolean).join(" ") ||
        "Unknown borrower";
      const vehicleLabel = vehicle
        ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || null
        : null;
      const state = getPolicyVerificationState(p, orgId, new Set());
      const lastVerified = p.lastVerifiedAt as Timestamp | undefined;

      rows.push({
        policyId: policyDoc.id,
        borrowerId: p.borrowerId ?? null,
        borrowerName,
        insuranceProvider: p.insuranceProvider ?? null,
        policyNumber: p.policyNumber ?? null,
        vin: vehicle?.vin ?? null,
        vehicleLabel,
        reason:
          state === VerificationState.INSURED_UNSUPPORTED
            ? "unsupported_carrier"
            : "no_adapter",
        lastVerifiedAt: lastVerified ? lastVerified.toMillis() : null,
      });
    }

    return { rows };
  },
);

export const markPolicyManuallyVerified = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request): Promise<{ success: true }> => {
    const { user } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as
      | {
          organizationId?: string;
          policyId?: string;
          note?: string;
          confirmedExpirationDate?: string;
        }
      | undefined;
    if (!data?.organizationId || !data.policyId) {
      throw new HttpsError(
        "invalid-argument",
        "organizationId and policyId are required",
      );
    }
    const orgId = data.organizationId;
    if (!isSuperAdmin(request)) {
      requireOrg(user, orgId);
    }

    const policyRef = collections.policies.doc(data.policyId);
    const policySnap = await policyRef.get();
    if (!policySnap.exists) {
      throw new HttpsError("not-found", `Policy ${data.policyId} not found`);
    }
    const policy = policySnap.data()!;
    if (policy.organizationId !== orgId) {
      throw new HttpsError(
        "permission-denied",
        "Policy does not belong to this organization",
      );
    }

    // Clear the "needs verification" markers; leave real coverage issues intact.
    const existingIssues = (policy.complianceIssues as string[] | undefined) ?? [];
    const remainingIssues = existingIssues.filter(
      (c) =>
        c !== ComplianceIssue.UNVERIFIED &&
        c !== ComplianceIssue.AWAITING_CREDENTIALS,
    );
    const dashboardStatus =
      remainingIssues.length === 0
        ? DashboardStatus.GREEN
        : (policy.dashboardStatus as DashboardStatus) ?? DashboardStatus.YELLOW;

    const update: Record<string, unknown> = {
      complianceIssues: remainingIssues,
      dashboardStatus,
      verificationSource: "manual-dealer",
      manualVerifiedBy: user.email ?? "unknown",
      manualVerifiedAt: FieldValue.serverTimestamp(),
      lastVerifiedAt: FieldValue.serverTimestamp(),
      lastVerificationError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (typeof data.note === "string" && data.note.trim()) {
      update.manualVerificationNote = data.note.trim().slice(0, 500);
    }
    if (
      typeof data.confirmedExpirationDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(data.confirmedExpirationDate)
    ) {
      const existingPeriod = policy.coveragePeriod as
        | { startDate?: string; endDate?: string }
        | undefined;
      const startDate =
        existingPeriod?.startDate ?? new Date().toISOString().slice(0, 10);
      update.coveragePeriod = {
        startDate,
        endDate: data.confirmedExpirationDate,
      };
      // If currently flagged UNVERIFIED-only, a future expiry means active.
      if (
        remainingIssues.length === 0 &&
        policy.status === PolicyStatus.UNVERIFIED
      ) {
        update.status = PolicyStatus.ACTIVE;
        update.policyStatus = PolicyStatus.ACTIVE;
      }
    }

    await policyRef.update(update);

    await logAudit({
      organizationId: orgId,
      entityType: AuditEntityType.POLICY,
      entityId: data.policyId,
      action: AuditAction.VERIFICATION_COMPLETED,
      performedBy: user.email ?? "unknown",
      previousValue: {
        complianceIssues: existingIssues,
        dashboardStatus: policy.dashboardStatus ?? null,
      },
      newValue: {
        complianceIssues: remainingIssues,
        dashboardStatus,
        verificationSource: "manual-dealer",
      },
    });

    return { success: true };
  },
);
