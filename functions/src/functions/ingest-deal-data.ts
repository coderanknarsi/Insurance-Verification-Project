import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { UserRole } from "../types/user";
import { PolicyStatus, DashboardStatus, ComplianceIssue, Policy } from "../types/policy";
import { AuditAction, AuditEntityType } from "../types/audit";
import { SmsConsentStatus } from "../types/borrower";

interface IngestDealDataInput {
  organizationId: string;
  borrower: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    loanNumber?: string;
    smsConsent?: boolean;
  };
  vehicle: {
    vin: string;
    make?: string;
    model?: string;
    year?: number;
  };
  insurance?: {
    provider?: string;
    policyNumber?: string;
  };
}

function validateInput(data: IngestDealDataInput): void {
  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }
  const b = data.borrower;
  if (!b || !b.firstName || !b.lastName) {
    throw new HttpsError(
      "invalid-argument",
      "borrower requires firstName and lastName."
    );
  }
  if (!b.email && !b.phone) {
    throw new HttpsError(
      "invalid-argument",
      "borrower requires at least an email or phone number."
    );
  }
  const v = data.vehicle;
  if (!v || !v.vin) {
    throw new HttpsError(
      "invalid-argument",
      "vehicle requires vin."
    );
  }
  if (v.year && (typeof v.year !== "number" || v.year < 1900 || v.year > new Date().getFullYear() + 2)) {
    throw new HttpsError("invalid-argument", "vehicle.year is invalid.");
  }
}

export const ingestDealData = onCall(async (request) => {
  const { uid, user } = await requireAuth(request);
  const data = request.data as IngestDealDataInput;

  validateInput(data);
  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
  requireOrg(user, data.organizationId);

  const now = Timestamp.now();

  // Check if borrower already exists by loanNumber within the org (only if loanNumber provided)
  const existingBorrowerSnap = data.borrower.loanNumber
    ? await collections.borrowers
        .where("organizationId", "==", data.organizationId)
        .where("loanNumber", "==", data.borrower.loanNumber)
        .limit(1)
        .get()
    : { empty: true, docs: [] } as unknown as FirebaseFirestore.QuerySnapshot;

  let borrowerId: string;
  let isNewBorrower = false;

  if (!existingBorrowerSnap.empty) {
    // Update existing borrower
    borrowerId = existingBorrowerSnap.docs[0].id;
    const previousValue = existingBorrowerSnap.docs[0].data();

    await collections.borrowers.doc(borrowerId).update({
      firstName: data.borrower.firstName,
      lastName: data.borrower.lastName,
      ...(data.borrower.email && { email: data.borrower.email }),
      ...(data.borrower.phone && { phone: data.borrower.phone }),
      ...(data.borrower.smsConsent !== undefined && data.borrower.phone && {
        smsConsentStatus: data.borrower.smsConsent ? SmsConsentStatus.OPTED_IN : SmsConsentStatus.NOT_SET,
        ...(data.borrower.smsConsent && { smsOptInTimestamp: now }),
      }),
      updatedAt: now,
    });

    await logAudit({
      organizationId: data.organizationId,
      entityType: AuditEntityType.BORROWER,
      entityId: borrowerId,
      action: AuditAction.UPDATED,
      performedBy: uid,
      previousValue: previousValue as unknown as Record<string, unknown>,
      newValue: data.borrower as unknown as Record<string, unknown>,
    });
  } else {
    // Create new borrower
    isNewBorrower = true;
    const borrowerRef = collections.borrowers.doc();
    borrowerId = borrowerRef.id;

    await borrowerRef.set({
      organizationId: data.organizationId,
      firstName: data.borrower.firstName,
      lastName: data.borrower.lastName,
      ...(data.borrower.email && { email: data.borrower.email }),
      ...(data.borrower.phone && { phone: data.borrower.phone }),
      ...(!data.borrower.email && !data.borrower.phone && { contactIncomplete: true }),
      ...(data.borrower.loanNumber && { loanNumber: data.borrower.loanNumber }),
      ...(data.borrower.smsConsent && data.borrower.phone && {
        smsConsentStatus: SmsConsentStatus.OPTED_IN,
        smsOptInTimestamp: now,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await logAudit({
      organizationId: data.organizationId,
      entityType: AuditEntityType.BORROWER,
      entityId: borrowerId,
      action: AuditAction.CREATED,
      performedBy: uid,
      newValue: data.borrower as unknown as Record<string, unknown>,
    });
  }

  // Check if vehicle already exists by VIN within the org
  const existingVehicleSnap = await collections.vehicles
    .where("organizationId", "==", data.organizationId)
    .where("vin", "==", data.vehicle.vin)
    .limit(1)
    .get();

  let vehicleId: string;

  if (!existingVehicleSnap.empty) {
    vehicleId = existingVehicleSnap.docs[0].id;
    const previousValue = existingVehicleSnap.docs[0].data();

    // Update existing vehicle and reassign to this borrower
    await collections.vehicles.doc(vehicleId).update({
      borrowerId,
      ...(data.vehicle.make && { make: data.vehicle.make }),
      ...(data.vehicle.model && { model: data.vehicle.model }),
      ...(data.vehicle.year && { year: data.vehicle.year }),
      updatedAt: now,
    });

    await logAudit({
      organizationId: data.organizationId,
      entityType: AuditEntityType.VEHICLE,
      entityId: vehicleId,
      action: AuditAction.UPDATED,
      performedBy: uid,
      previousValue: previousValue as unknown as Record<string, unknown>,
      newValue: { ...data.vehicle, borrowerId } as unknown as Record<string, unknown>,
    });
  } else {
    // Create new vehicle
    const vehicleRef = collections.vehicles.doc();
    vehicleId = vehicleRef.id;

    await vehicleRef.set({
      borrowerId,
      organizationId: data.organizationId,
      vin: data.vehicle.vin,
      make: data.vehicle.make || "Unknown",
      model: data.vehicle.model || "Unknown",
      year: data.vehicle.year || 0,
      createdAt: now,
      updatedAt: now,
    });

    await logAudit({
      organizationId: data.organizationId,
      entityType: AuditEntityType.VEHICLE,
      entityId: vehicleId,
      action: AuditAction.CREATED,
      performedBy: uid,
      newValue: data.vehicle as unknown as Record<string, unknown>,
    });
  }

  // Create an initial UNVERIFIED policy if none exists for this vehicle
  const existingPolicySnap = await collections.policies
    .where("vehicleId", "==", vehicleId)
    .where("organizationId", "==", data.organizationId)
    .limit(1)
    .get();

  let policyId: string;

  if (existingPolicySnap.empty) {
    const policyRef = collections.policies.doc();
    policyId = policyRef.id;

    const hasCredentials = !!(data.insurance?.provider && data.insurance?.policyNumber);
    const policyData: Record<string, unknown> = {
      vehicleId,
      borrowerId,
      organizationId: data.organizationId,
      status: PolicyStatus.UNVERIFIED,
      dashboardStatus: DashboardStatus.RED,
      complianceIssues: hasCredentials
        ? [ComplianceIssue.UNVERIFIED]
        : [ComplianceIssue.UNVERIFIED, ComplianceIssue.AWAITING_CREDENTIALS],
      createdAt: now,
      updatedAt: now,
    };
    if (data.insurance?.provider) policyData.insuranceProvider = data.insurance.provider;
    if (data.insurance?.policyNumber) policyData.policyNumber = data.insurance.policyNumber;
    if (!hasCredentials) policyData.awaitingCredentials = true;
    await policyRef.set(policyData as unknown as Policy);

    await logAudit({
      organizationId: data.organizationId,
      entityType: AuditEntityType.POLICY,
      entityId: policyId,
      action: AuditAction.CREATED,
      performedBy: uid,
      newValue: { vehicleId, borrowerId, status: "UNVERIFIED" },
    });
  } else {
    policyId = existingPolicySnap.docs[0].id;
  }

  // Update org's active monitored count
  const borrowerCount = await collections.borrowers
    .where("organizationId", "==", data.organizationId)
    .count()
    .get();

  await collections.organizations.doc(data.organizationId).update({
    "subscription.activeMonitoredCount": borrowerCount.data().count,
    updatedAt: now,
  } as FirebaseFirestore.UpdateData<unknown>);

  return {
    borrowerId,
    vehicleId,
    policyId,
    isNewBorrower,
  };
});
