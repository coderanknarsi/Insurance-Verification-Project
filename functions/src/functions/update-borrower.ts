import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { UserRole } from "../types/user";
import { AuditAction, AuditEntityType } from "../types/audit";
import { SmsConsentStatus } from "../types/borrower";

interface UpdateBorrowerInput {
  organizationId: string;
  borrowerId: string;
  updates: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    smsConsentStatus?: SmsConsentStatus;
  };
}

export const updateBorrower = onCall(async (request) => {
  const { uid, user } = await requireAuth(request);
  const data = request.data as UpdateBorrowerInput;

  if (!data.organizationId || !data.borrowerId) {
    throw new HttpsError("invalid-argument", "organizationId and borrowerId are required.");
  }

  if (!data.updates || Object.keys(data.updates).length === 0) {
    throw new HttpsError("invalid-argument", "At least one field to update is required.");
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

  // Build update object with only provided fields
  const allowedFields = ["firstName", "lastName", "email", "phone", "smsConsentStatus"] as const;
  const updateFields: Record<string, unknown> = { updatedAt: Timestamp.now() };

  for (const field of allowedFields) {
    if (data.updates[field] !== undefined) {
      updateFields[field] = data.updates[field];
    }
  }

  // Track SMS consent timestamps
  if (data.updates.smsConsentStatus === SmsConsentStatus.OPTED_IN) {
    updateFields.smsOptInTimestamp = Timestamp.now();
  } else if (data.updates.smsConsentStatus === SmsConsentStatus.OPTED_OUT) {
    updateFields.smsOptOutTimestamp = Timestamp.now();
  }

  // If email or phone is provided, remove contactIncomplete flag
  if (data.updates.email || data.updates.phone) {
    updateFields.contactIncomplete = false;
  }

  const previousValue = borrowerSnap.data() as unknown as Record<string, unknown>;

  await borrowerRef.update(updateFields);

  await logAudit({
    organizationId: data.organizationId,
    entityType: AuditEntityType.BORROWER,
    entityId: data.borrowerId,
    action: AuditAction.UPDATED,
    performedBy: uid,
    previousValue,
    newValue: data.updates as unknown as Record<string, unknown>,
  });

  return { success: true };
});
