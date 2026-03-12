import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { measureOneClient } from "../services/measureone";
import { UserRole } from "../types/user";
import { PolicyStatus, DashboardStatus } from "../types/policy";
import { AuditAction, AuditEntityType } from "../types/audit";

interface CsvRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  loanNumber: string;
  vin: string;
  make: string;
  model: string;
  year: number;
}

interface BulkImportInput {
  organizationId: string;
  rows: CsvRow[];
}

interface RowResult {
  row: number;
  loanNumber: string;
  status: "created" | "updated" | "error";
  borrowerId?: string;
  vehicleId?: string;
  error?: string;
}

function validateRow(row: CsvRow, index: number): string | null {
  if (!row.firstName || !row.lastName) return `Row ${index + 1}: firstName and lastName required.`;
  if (!row.email) return `Row ${index + 1}: email required.`;
  if (!row.phone) return `Row ${index + 1}: phone required.`;
  if (!row.loanNumber) return `Row ${index + 1}: loanNumber required.`;
  if (!row.vin) return `Row ${index + 1}: vin required.`;
  if (!row.make || !row.model) return `Row ${index + 1}: make and model required.`;
  if (!row.year || row.year < 1900 || row.year > new Date().getFullYear() + 2) {
    return `Row ${index + 1}: invalid year.`;
  }
  return null;
}

export const bulkImportDeals = onCall(
  { timeoutSeconds: 300 },
  async (request) => {
    const { uid, user } = await requireAuth(request);
    const data = request.data as BulkImportInput;

    if (!data.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required.");
    }
    if (!Array.isArray(data.rows) || data.rows.length === 0) {
      throw new HttpsError("invalid-argument", "rows array is required and must not be empty.");
    }
    if (data.rows.length > 500) {
      throw new HttpsError("invalid-argument", "Maximum 500 rows per import.");
    }

    requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    requireOrg(user, data.organizationId);

    const now = Timestamp.now();
    const results: RowResult[] = [];

    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i];
      const validationError = validateRow(row, i);

      if (validationError) {
        results.push({
          row: i + 1,
          loanNumber: row.loanNumber || "N/A",
          status: "error",
          error: validationError,
        });
        continue;
      }

      try {
        // Upsert borrower by loanNumber
        const existingBorrowerSnap = await collections.borrowers
          .where("organizationId", "==", data.organizationId)
          .where("loanNumber", "==", row.loanNumber)
          .limit(1)
          .get();

        let borrowerId: string;
        let isNew = false;

        if (!existingBorrowerSnap.empty) {
          borrowerId = existingBorrowerSnap.docs[0].id;
          await collections.borrowers.doc(borrowerId).update({
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            phone: row.phone,
            updatedAt: now,
          });
        } else {
          isNew = true;
          const ref = collections.borrowers.doc();
          borrowerId = ref.id;
          await ref.set({
            organizationId: data.organizationId,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            phone: row.phone,
            loanNumber: row.loanNumber,
            createdAt: now,
            updatedAt: now,
          });

          // Create MeasureOne individual (best-effort)
          try {
            const individual = await measureOneClient.createIndividual({
              first_name: row.firstName,
              last_name: row.lastName,
              email: row.email,
              phone: row.phone,
            });
            await collections.borrowers.doc(borrowerId).update({
              measureOneIndividualId: individual.id,
              updatedAt: Timestamp.now(),
            });
          } catch (err) {
            console.error(`Row ${i + 1}: MeasureOne individual creation failed:`, err);
          }
        }

        // Upsert vehicle by VIN
        const existingVehicleSnap = await collections.vehicles
          .where("organizationId", "==", data.organizationId)
          .where("vin", "==", row.vin)
          .limit(1)
          .get();

        let vehicleId: string;

        if (!existingVehicleSnap.empty) {
          vehicleId = existingVehicleSnap.docs[0].id;
          await collections.vehicles.doc(vehicleId).update({
            borrowerId,
            make: row.make,
            model: row.model,
            year: row.year,
            updatedAt: now,
          });
        } else {
          const ref = collections.vehicles.doc();
          vehicleId = ref.id;
          await ref.set({
            borrowerId,
            organizationId: data.organizationId,
            vin: row.vin,
            make: row.make,
            model: row.model,
            year: row.year,
            createdAt: now,
            updatedAt: now,
          });
        }

        // Create initial UNVERIFIED policy if none exists
        const existingPolicySnap = await collections.policies
          .where("vehicleId", "==", vehicleId)
          .where("organizationId", "==", data.organizationId)
          .limit(1)
          .get();

        if (existingPolicySnap.empty) {
          await collections.policies.doc().set({
            vehicleId,
            borrowerId,
            organizationId: data.organizationId,
            status: PolicyStatus.UNVERIFIED,
            dashboardStatus: DashboardStatus.RED,
            createdAt: now,
            updatedAt: now,
          });
        }

        results.push({
          row: i + 1,
          loanNumber: row.loanNumber,
          status: isNew ? "created" : "updated",
          borrowerId,
          vehicleId,
        });
      } catch (err) {
        results.push({
          row: i + 1,
          loanNumber: row.loanNumber,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
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

    // Audit the bulk import
    await logAudit({
      organizationId: data.organizationId,
      entityType: AuditEntityType.BORROWER,
      entityId: "BULK_IMPORT",
      action: AuditAction.CREATED,
      performedBy: uid,
      newValue: {
        totalRows: data.rows.length,
        created: results.filter((r) => r.status === "created").length,
        updated: results.filter((r) => r.status === "updated").length,
        errors: results.filter((r) => r.status === "error").length,
      },
    });

    return {
      total: data.rows.length,
      created: results.filter((r) => r.status === "created").length,
      updated: results.filter((r) => r.status === "updated").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
    };
  }
);
