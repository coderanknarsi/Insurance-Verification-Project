import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { UserRole } from "../types/user";
import { PolicyStatus, DashboardStatus, ComplianceIssue, Policy } from "../types/policy";
import { AuditAction, AuditEntityType } from "../types/audit";
import { Borrower, SmsConsentStatus } from "../types/borrower";

interface CsvRow {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  loanNumber?: string;
  vin: string;
  make?: string;
  model?: string;
  year?: number;
  insuranceProvider?: string;
  policyNumber?: string;
}

interface BulkImportInput {
  organizationId: string;
  rows: CsvRow[];
  smsConsent?: boolean;
}

interface RowResult {
  row: number;
  loanNumber: string;
  status: "created" | "updated" | "error";
  borrowerId?: string;
  vehicleId?: string;
  error?: string;
  warnings?: string[];
}

interface VinDecodeResult {
  make: string;
  model: string;
  year: number;
}

/** Decode make/model/year from VIN using the free NHTSA vPIC API. */
async function decodeVin(vin: string): Promise<VinDecodeResult | null> {
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const json = await resp.json() as { Results?: Array<{ Make?: string; Model?: string; ModelYear?: string }> };
    const r = json.Results?.[0];
    if (!r || !r.Make || !r.Model || !r.ModelYear) return null;
    const year = parseInt(r.ModelYear, 10);
    if (isNaN(year)) return null;
    return { make: r.Make, model: r.Model, year };
  } catch {
    return null;
  }
}

function getRowIdentifier(row: CsvRow): string {
  return row.loanNumber || row.vin || "N/A";
}

export function validateCsvImportRow(
  row: CsvRow,
  index: number,
): { error: string | null; warnings: string[] } {
  const warnings: string[] = [];

  // Hard requirements: name + VIN + at least one contact method
  if (!row.firstName || !row.lastName) return { error: `Row ${index + 1}: firstName and lastName required.`, warnings };
  if (!row.vin) return { error: `Row ${index + 1}: vin required.`, warnings };
  if (!row.email && !row.phone) return { error: `Row ${index + 1}: email or phone required.`, warnings };

  // Soft warnings
  if (!row.loanNumber) {
    warnings.push(`Row ${index + 1}: No loan number provided — matching will use VIN.`);
  }
  if (!row.email) {
    warnings.push(`Row ${index + 1}: No email provided.`);
  } else if (!row.phone) {
    warnings.push(`Row ${index + 1}: No phone provided.`);
  }

  return { error: null, warnings };
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
      const { error: validationError, warnings } = validateCsvImportRow(row, i);

      if (validationError) {
        results.push({
          row: i + 1,
          loanNumber: getRowIdentifier(row),
          status: "error",
          error: validationError,
        });
        continue;
      }

      // Auto-fill make/model/year from VIN if missing
      if (!row.make || !row.model || !row.year) {
        const decoded = await decodeVin(row.vin);
        if (decoded) {
          if (!row.make) row.make = decoded.make;
          if (!row.model) row.model = decoded.model;
          if (!row.year) row.year = decoded.year;
        } else if (!row.make || !row.model) {
          warnings.push(`Row ${i + 1}: Could not decode vehicle info from VIN.`);
        }
      }

      try {
        const existingVehicleSnap = await collections.vehicles
          .where("organizationId", "==", data.organizationId)
          .where("vin", "==", row.vin)
          .limit(1)
          .get();

        let borrowerId: string;
        let isNew = false;
        let existingBorrower: FirebaseFirestore.DocumentSnapshot | null = null;

        if (row.loanNumber) {
          const existingBorrowerSnap = await collections.borrowers
            .where("organizationId", "==", data.organizationId)
            .where("loanNumber", "==", row.loanNumber)
            .limit(1)
            .get();

          if (!existingBorrowerSnap.empty) {
            existingBorrower = existingBorrowerSnap.docs[0];
          }
        }

        if (!existingBorrower && !existingVehicleSnap.empty) {
          const vehicleBorrowerId = existingVehicleSnap.docs[0].data().borrowerId;
          if (vehicleBorrowerId) {
            const borrowerSnap = await collections.borrowers.doc(vehicleBorrowerId).get();
            if (borrowerSnap.exists) {
              existingBorrower = borrowerSnap;
            }
          }
        }

        if (existingBorrower) {
          borrowerId = existingBorrower.id;
          const updateData: Partial<Borrower> = {
            firstName: row.firstName,
            lastName: row.lastName,
            updatedAt: now,
          };
          if (row.email) updateData.email = row.email;
          if (row.phone) updateData.phone = row.phone;
          if (row.loanNumber) updateData.loanNumber = row.loanNumber;
          if (data.smsConsent && row.phone) {
            updateData.smsConsentStatus = SmsConsentStatus.OPTED_IN;
            updateData.smsOptInTimestamp = now;
          }
          await collections.borrowers.doc(borrowerId).update(updateData);
        } else {
          isNew = true;
          const ref = collections.borrowers.doc();
          borrowerId = ref.id;
          const borrowerData: Borrower = {
            organizationId: data.organizationId,
            firstName: row.firstName,
            lastName: row.lastName,
            ...(row.email && { email: row.email }),
            ...(row.phone && { phone: row.phone }),
            ...(row.loanNumber && { loanNumber: row.loanNumber }),
            ...(data.smsConsent && row.phone && {
              smsConsentStatus: SmsConsentStatus.OPTED_IN,
              smsOptInTimestamp: now,
            }),
            createdAt: now,
            updatedAt: now,
          };
          await ref.set(borrowerData);
        }
        let vehicleId: string;

        if (!existingVehicleSnap.empty) {
          vehicleId = existingVehicleSnap.docs[0].id;
          const vehicleUpdate: Record<string, unknown> = { borrowerId, updatedAt: now };
          if (row.make) vehicleUpdate.make = row.make;
          if (row.model) vehicleUpdate.model = row.model;
          if (row.year) vehicleUpdate.year = row.year;
          await collections.vehicles.doc(vehicleId).update(vehicleUpdate);
        } else {
          const ref = collections.vehicles.doc();
          vehicleId = ref.id;
          await ref.set({
            borrowerId,
            organizationId: data.organizationId,
            vin: row.vin,
            make: row.make || "Unknown",
            model: row.model || "Unknown",
            year: row.year || 0,
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
          const hasCredentials = !!(row.insuranceProvider && row.policyNumber);
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
          if (row.insuranceProvider) policyData.insuranceProvider = row.insuranceProvider;
          if (row.policyNumber) policyData.policyNumber = row.policyNumber;
          if (!hasCredentials) policyData.awaitingCredentials = true;
          await collections.policies.doc().set(policyData as unknown as Policy);
        }

        results.push({
          row: i + 1,
          loanNumber: getRowIdentifier(row),
          status: isNew ? "created" : "updated",
          borrowerId,
          vehicleId,
          warnings: warnings.length > 0 ? warnings : undefined,
        });
      } catch (err) {
        results.push({
          row: i + 1,
          loanNumber: getRowIdentifier(row),
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

    const totalWarnings = results.reduce((n, r) => n + (r.warnings?.length ?? 0), 0);

    return {
      total: data.rows.length,
      created: results.filter((r) => r.status === "created").length,
      updated: results.filter((r) => r.status === "updated").length,
      errors: results.filter((r) => r.status === "error").length,
      warnings: totalWarnings,
      results,
    };
  }
);
