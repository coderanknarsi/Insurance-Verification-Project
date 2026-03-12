import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { measureOneClient } from "../services/measureone";
import { UserRole } from "../types/user";
import { NotificationType, NotificationTrigger, NotificationStatus } from "../types/notification";
import { AuditAction, AuditEntityType } from "../types/audit";

interface SendVerificationLinkInput {
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
  channel: "EMAIL" | "SMS";
}

/**
 * Creates a verification request and logs a notification record
 * indicating the link should be sent to the borrower.
 * For MVP, returns the URL for manual sending. Future: auto-deliver via SendGrid/Twilio.
 */
export const sendVerificationLink = onCall(async (request) => {
  const { uid, user } = await requireAuth(request);
  const data = request.data as SendVerificationLinkInput;

  if (!data.organizationId || !data.borrowerId || !data.vehicleId) {
    throw new HttpsError(
      "invalid-argument",
      "organizationId, borrowerId, and vehicleId are required."
    );
  }
  if (!data.channel || !["EMAIL", "SMS"].includes(data.channel)) {
    throw new HttpsError("invalid-argument", "channel must be EMAIL or SMS.");
  }

  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
  requireOrg(user, data.organizationId);

  // Get borrower for contact info
  const borrowerSnap = await collections.borrowers.doc(data.borrowerId).get();
  if (!borrowerSnap.exists) {
    throw new HttpsError("not-found", "Borrower not found.");
  }
  const borrower = borrowerSnap.data()!;
  if (borrower.organizationId !== data.organizationId) {
    throw new HttpsError("permission-denied", "Borrower does not belong to this organization.");
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

  // Update policy with data request ID
  const now = Timestamp.now();
  const policySnap = await collections.policies
    .where("vehicleId", "==", data.vehicleId)
    .where("organizationId", "==", data.organizationId)
    .limit(1)
    .get();

  if (!policySnap.empty) {
    await collections.policies.doc(policySnap.docs[0].id).update({
      measureOneDataRequestId: dataRequest.id,
      updatedAt: now,
    });
  }

  // Create notification record
  const recipient = data.channel === "EMAIL" ? borrower.email : borrower.phone;
  const notifRef = collections.notifications.doc();
  await notifRef.set({
    borrowerId: data.borrowerId,
    organizationId: data.organizationId,
    type: data.channel === "EMAIL" ? NotificationType.EMAIL : NotificationType.SMS,
    trigger: NotificationTrigger.LAPSE_DETECTED,
    status: NotificationStatus.PENDING,
    content: `Insurance verification link sent to ${recipient}: ${invitation.url}`,
    createdAt: now,
  });

  await logAudit({
    organizationId: data.organizationId,
    entityType: AuditEntityType.BORROWER,
    entityId: data.borrowerId,
    action: AuditAction.VERIFICATION_REQUESTED,
    performedBy: uid,
    newValue: {
      channel: data.channel,
      recipient,
      dataRequestId: dataRequest.id,
      notificationId: notifRef.id,
    },
  });

  return {
    invitationUrl: invitation.url,
    dataRequestId: dataRequest.id,
    notificationId: notifRef.id,
    recipient,
  };
});
