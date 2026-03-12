import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { requireAuth, requireOrg } from "../middleware/auth";
import { DashboardStatus } from "../types/policy";

interface GetBorrowersInput {
  organizationId: string;
  dashboardStatus?: DashboardStatus;
  limit?: number;
  startAfter?: string;
}

export const getBorrowers = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as GetBorrowersInput;

  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  requireOrg(user, data.organizationId);

  const pageSize = Math.min(data.limit ?? 50, 100);

  // Get borrowers for this org
  let borrowerQuery = collections.borrowers
    .where("organizationId", "==", data.organizationId)
    .orderBy("lastName")
    .limit(pageSize);

  if (data.startAfter) {
    const startDoc = await collections.borrowers.doc(data.startAfter).get();
    if (startDoc.exists) {
      borrowerQuery = borrowerQuery.startAfter(startDoc);
    }
  }

  const borrowerSnap = await borrowerQuery.get();
  const borrowers = borrowerSnap.docs.map((doc) => doc.data());

  // For each borrower, fetch their vehicles and policies
  const enriched = await Promise.all(
    borrowers.map(async (borrower) => {
      const vehicleSnap = await collections.vehicles
        .where("borrowerId", "==", borrower.id)
        .where("organizationId", "==", data.organizationId)
        .get();

      const vehicles = await Promise.all(
        vehicleSnap.docs.map(async (vDoc) => {
          const vehicle = vDoc.data();

          const policySnap = await collections.policies
            .where("vehicleId", "==", vehicle.id)
            .where("organizationId", "==", data.organizationId)
            .limit(1)
            .get();

          const policy = policySnap.empty ? null : policySnap.docs[0].data();

          return { ...vehicle, policy };
        })
      );

      // Determine worst dashboard status across all vehicles
      const statuses = vehicles
        .map((v) => v.policy?.dashboardStatus)
        .filter(Boolean);
      const overallStatus = statuses.includes(DashboardStatus.RED)
        ? DashboardStatus.RED
        : statuses.includes(DashboardStatus.YELLOW)
          ? DashboardStatus.YELLOW
          : statuses.includes(DashboardStatus.GREEN)
            ? DashboardStatus.GREEN
            : DashboardStatus.RED;

      return { ...borrower, vehicles, overallStatus };
    })
  );

  // Filter by dashboardStatus if requested
  const filtered = data.dashboardStatus
    ? enriched.filter((b) => b.overallStatus === data.dashboardStatus)
    : enriched;

  return {
    borrowers: filtered,
    hasMore: borrowerSnap.docs.length === pageSize,
    lastId: borrowerSnap.docs.length > 0
      ? borrowerSnap.docs[borrowerSnap.docs.length - 1].id
      : null,
  };
});

/**
 * Get dashboard summary counts by status for an organization.
 */
export const getDashboardSummary = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as { organizationId: string };

  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  requireOrg(user, data.organizationId);

  const [greenSnap, yellowSnap, redSnap, totalBorrowersSnap] = await Promise.all([
    collections.policies
      .where("organizationId", "==", data.organizationId)
      .where("dashboardStatus", "==", "GREEN")
      .count()
      .get(),
    collections.policies
      .where("organizationId", "==", data.organizationId)
      .where("dashboardStatus", "==", "YELLOW")
      .count()
      .get(),
    collections.policies
      .where("organizationId", "==", data.organizationId)
      .where("dashboardStatus", "==", "RED")
      .count()
      .get(),
    collections.borrowers
      .where("organizationId", "==", data.organizationId)
      .count()
      .get(),
  ]);

  return {
    green: greenSnap.data().count,
    yellow: yellowSnap.data().count,
    red: redSnap.data().count,
    totalBorrowers: totalBorrowersSnap.data().count,
  };
});
