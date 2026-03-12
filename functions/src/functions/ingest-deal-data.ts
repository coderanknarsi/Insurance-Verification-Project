import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { measureOneClient } from "../services/measureone";
import { UserRole } from "../types/user";
import { PolicyStatus, DashboardStatus } from "../types/policy";
import { AuditAction, AuditEntityType } from "../types/audit";

interface IngestDealDataInput {
  organizationId: string;
  borrower: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    loanNumber: string;
  };
  vehicle: {
    vin: string;
    make: string;
    model: string;
    year: number;
  };
}

function validateInput(data: IngestDealDataInput): void {
  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }
  const b = data.borrower;
  if (!b || !b.firstName || !b.lastName || !b.email || !b.phone || !b.loanNumber) {
    throw new HttpsError(
      "invalid-argument",
      "borrower requires firstName, lastName, email, phone, and loanNumber."
    );
  }
  const v = data.vehicle;
  if (!v || !v.vin || !v.make || !v.model || !v.year) {
    throw new HttpsError(
      "invalid-argument",
      "vehicle requires vin, make, model, and year."
    );
  }
  if (typeof v.year !== "number" || v.year < 1900 || v.year > new Date().getFullYear() + 2) {
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

  // Check if borrower already exists by loanNumber within the org
  const existingBorrowerSnap = await collections.borrowers
    .where("organizationId", "==", data.organizationId)
    .where("loanNumber", "==", data.borrower.loanNumber)
    .limit(1)
    .get();

  let borrowerId: string;
  let isNewBorrower = false;

  if (!existingBorrowerSnap.empty) {
    // Update existing borrower
    borrowerId = existingBorrowerSnap.docs[0].id;
    const previousValue = existingBorrowerSnap.docs[0].data();

    await collections.borrowers.doc(borrowerId).update({
      firstName: data.borrower.firstName,
      lastName: data.borrower.lastName,
      email: data.borrower.email,
      phone: data.borrower.phone,
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
      email: data.borrower.email,
      phone: data.borrower.phone,
      loanNumber: data.borrower.loanNumber,
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

  // Create MeasureOne individual for new borrowers
  if (isNewBorrower) {
    try {
      const individual = await measureOneClient.createIndividual({
        first_name: data.borrower.firstName,
        last_name: data.borrower.lastName,
        email: data.borrower.email,
        phone: data.borrower.phone,
      });

      await collections.borrowers.doc(borrowerId).update({
        measureOneIndividualId: individual.id,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      // Log but don't fail — MeasureOne individual can be created later
      console.error("Failed to create MeasureOne individual:", err);
    }
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
      make: data.vehicle.make,
      model: data.vehicle.model,
      year: data.vehicle.year,
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
      make: data.vehicle.make,
      model: data.vehicle.model,
      year: data.vehicle.year,
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

    await policyRef.set({
      vehicleId,
      borrowerId,
      organizationId: data.organizationId,
      status: PolicyStatus.UNVERIFIED,
      dashboardStatus: DashboardStatus.RED,
      createdAt: now,
      updatedAt: now,
    });

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
