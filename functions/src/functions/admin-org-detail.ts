import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { requireSuperAdmin } from "../middleware/auth";
import { PolicyStatus, ComplianceIssue } from "../types/policy";

export const getAdminOrgDetail = onCall(
  { region: "us-central1" },
  async (request) => {
    requireSuperAdmin(request);

    const { organizationId } = request.data as { organizationId?: string };
    if (!organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required.");
    }

    // Verify org exists
    const orgSnap = await collections.organizations.doc(organizationId).get();
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }

    // Fetch borrowers (capped at 200 for admin view)
    const borrowerSnap = await collections.borrowers
      .where("organizationId", "==", organizationId)
      .orderBy("lastName")
      .limit(200)
      .get();

    const borrowers = await Promise.all(
      borrowerSnap.docs.map(async (doc) => {
        const borrower = doc.data();

        const vehicleSnap = await collections.vehicles
          .where("borrowerId", "==", borrower.id)
          .where("organizationId", "==", organizationId)
          .get();

        const vehicles = await Promise.all(
          vehicleSnap.docs.map(async (vDoc) => {
            const vehicle = vDoc.data();

            const policySnap = await collections.policies
              .where("vehicleId", "==", vehicle.id)
              .where("organizationId", "==", organizationId)
              .limit(1)
              .get();

            const policy = policySnap.empty ? null : policySnap.docs[0].data();

            if (
              policy &&
              policy.status === PolicyStatus.UNVERIFIED &&
              (!policy.complianceIssues || policy.complianceIssues.length === 0)
            ) {
              policy.complianceIssues = [ComplianceIssue.UNVERIFIED];
            }

            return {
              id: vehicle.id,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              vin: vehicle.vin,
              policy: policy
                ? {
                    status: policy.status,
                    dashboardStatus: policy.dashboardStatus,
                    complianceIssues: policy.complianceIssues ?? [],
                    expirationDate: policy.coveragePeriod?.endDate ?? null,
                    carrierName: policy.insuranceProvider ?? null,
                    policyNumber: policy.policyNumber ?? null,
                  }
                : null,
            };
          })
        );

        return {
          id: borrower.id,
          firstName: borrower.firstName,
          lastName: borrower.lastName,
          email: borrower.email,
          phone: borrower.phone ?? null,
          vehicles,
        };
      })
    );

    // Recent notifications for this org (last 50)
    const notifSnap = await collections.notifications
      .where("organizationId", "==", organizationId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const notifications = notifSnap.docs.map((d) => {
      const n = d.data();
      return {
        id: d.id,
        type: n.type,
        channel: n.channel ?? n.type,
        trigger: n.trigger,
        status: n.status,
        content: n.content,
        createdAt: n.createdAt?.toMillis() ?? 0,
      };
    });

    return { borrowers, notifications };
  }
);
