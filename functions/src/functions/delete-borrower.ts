import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { UserRole } from "../types/user";
import { AuditAction, AuditEntityType } from "../types/audit";

interface DeleteBorrowerInput {
  organizationId: string;
  borrowerId: string;
}

export const deleteBorrower = onCall(async (request) => {
  const { uid, user } = await requireAuth(request);
  const data = request.data as DeleteBorrowerInput;

  if (!data.organizationId || !data.borrowerId) {
    throw new HttpsError("invalid-argument", "organizationId and borrowerId are required.");
  }

  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
  requireOrg(user, data.organizationId);

  // Verify borrower exists and belongs to this org
  const borrowerRef = collections.borrowers.doc(data.borrowerId);
  const borrowerSnap = await borrowerRef.get();

  if (!borrowerSnap.exists) {
    throw new HttpsError("not-found", "Borrower not found.");
  }

  const borrowerData = borrowerSnap.data()!;
  if (borrowerData.organizationId !== data.organizationId) {
    throw new HttpsError("permission-denied", "Borrower does not belong to this organization.");
  }

  // Find and delete all vehicles for this borrower
  const vehiclesSnap = await collections.vehicles
    .where("borrowerId", "==", data.borrowerId)
    .where("organizationId", "==", data.organizationId)
    .get();

  // Find and delete all policies for this borrower's vehicles
  const vehicleIds = vehiclesSnap.docs.map((doc) => doc.id);

  // Delete policies for each vehicle
  for (const vehicleId of vehicleIds) {
    const policiesSnap = await collections.policies
      .where("vehicleId", "==", vehicleId)
      .get();

    for (const policyDoc of policiesSnap.docs) {
      await policyDoc.ref.delete();
    }
  }

  // Delete all vehicles
  for (const vehicleDoc of vehiclesSnap.docs) {
    await vehicleDoc.ref.delete();
  }

  // Delete notifications for this borrower
  const notificationsSnap = await collections.notifications
    .where("borrowerId", "==", data.borrowerId)
    .get();

  for (const notifDoc of notificationsSnap.docs) {
    await notifDoc.ref.delete();
  }

  // Delete the borrower
  await borrowerRef.delete();

  await logAudit({
    organizationId: data.organizationId,
    entityType: AuditEntityType.BORROWER,
    entityId: data.borrowerId,
    action: AuditAction.DELETED,
    performedBy: uid,
    previousValue: borrowerData as unknown as Record<string, unknown>,
  });

  return { success: true };
});
