import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { measureOneClient } from "../services/measureone";
import { UserRole } from "../types/user";
import { AuditAction, AuditEntityType } from "../types/audit";

interface CreateVerificationInput {
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
}

/**
 * Creates a MeasureOne data request for a borrower's vehicle,
 * stores the dataRequestId on the policy, and returns the invitation link.
 */
export const createVerificationRequest = onCall(async (request) => {
  const { uid, user } = await requireAuth(request);
  const data = request.data as CreateVerificationInput;

  if (!data.organizationId || !data.borrowerId || !data.vehicleId) {
    throw new HttpsError(
      "invalid-argument",
      "organizationId, borrowerId, and vehicleId are required."
    );
  }

  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
  requireOrg(user, data.organizationId);

  // Get borrower
  const borrowerSnap = await collections.borrowers.doc(data.borrowerId).get();
  if (!borrowerSnap.exists) {
    throw new HttpsError("not-found", "Borrower not found.");
  }
  const borrower = borrowerSnap.data()!;
  if (borrower.organizationId !== data.organizationId) {
    throw new HttpsError("permission-denied", "Borrower does not belong to this organization.");
  }

  // Get vehicle
  const vehicleSnap = await collections.vehicles.doc(data.vehicleId).get();
  if (!vehicleSnap.exists) {
    throw new HttpsError("not-found", "Vehicle not found.");
  }
  const vehicle = vehicleSnap.data()!;
  if (vehicle.organizationId !== data.organizationId) {
    throw new HttpsError("permission-denied", "Vehicle does not belong to this organization.");
  }

  // Ensure borrower has a MeasureOne individual ID
  let individualId = borrower.measureOneIndividualId;
  if (!individualId) {
    const individual = await measureOneClient.createIndividual({
      first_name: borrower.firstName,
      last_name: borrower.lastName,
      email: borrower.email,
      phone: borrower.phone,
    });
    individualId = individual.id;

    await collections.borrowers.doc(data.borrowerId).update({
      measureOneIndividualId: individualId,
      updatedAt: Timestamp.now(),
    });
  }

  // Create data request
  const dataRequest = await measureOneClient.createDataRequest({
    individual_id: individualId,
  });

  // Generate invitation link
  const invitation = await measureOneClient.generateInvitationLink({
    datarequest_id: dataRequest.id,
  });

  // Find or create policy for this vehicle
  const policySnap = await collections.policies
    .where("vehicleId", "==", data.vehicleId)
    .where("organizationId", "==", data.organizationId)
    .limit(1)
    .get();

  const now = Timestamp.now();

  if (!policySnap.empty) {
    const policyId = policySnap.docs[0].id;
    await collections.policies.doc(policyId).update({
      measureOneDataRequestId: dataRequest.id,
      updatedAt: now,
    });
  } else {
    // Create a new policy record linked to this data request
    const { PolicyStatus, DashboardStatus } = await import("../types/policy");
    await collections.policies.doc().set({
      vehicleId: data.vehicleId,
      borrowerId: data.borrowerId,
      organizationId: data.organizationId,
      measureOneDataRequestId: dataRequest.id,
      status: PolicyStatus.UNVERIFIED,
      dashboardStatus: DashboardStatus.RED,
      createdAt: now,
      updatedAt: now,
    });
  }

  await logAudit({
    organizationId: data.organizationId,
    entityType: AuditEntityType.POLICY,
    entityId: data.vehicleId,
    action: AuditAction.VERIFICATION_REQUESTED,
    performedBy: uid,
    newValue: {
      borrowerId: data.borrowerId,
      vehicleId: data.vehicleId,
      dataRequestId: dataRequest.id,
    },
  });

  return {
    invitationUrl: invitation.url,
    dataRequestId: dataRequest.id,
  };
});
