import { onCall } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { requireSuperAdmin } from "../middleware/auth";
import { PLAN_CONFIG, SubscriptionPlan, type StripeSubscriptionData } from "../types/subscription";
import { NotificationStatus } from "../types/notification";

interface AdminOrgSummary {
  id: string;
  name: string;
  type: string;
  plan: string;
  subscriptionStatus: string;
  borrowerCount: number;
  vehicleCount: number;
  userCount: number;
  createdAt: number;
}

interface PlanBreakdown {
  plan: string;
  priceMonthly: number;
  count: number;
  revenue: number;
}

interface NotificationStats {
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
}

interface AdminDashboardResponse {
  organizations: AdminOrgSummary[];
  totals: {
    organizations: number;
    borrowers: number;
    vehicles: number;
    users: number;
    mrr: number;
    activeSubscriptions: number;
    trialingSubscriptions: number;
  };
  revenue: {
    planBreakdown: PlanBreakdown[];
    statusBreakdown: Record<string, number>;
  };
  notifications: NotificationStats;
}

export const getAdminDashboard = onCall(
  { region: "us-central1" },
  async (request): Promise<AdminDashboardResponse> => {
    requireSuperAdmin(request);

    // Parallel: orgs + notification counts
    const [orgsSnap, sentSnap, deliveredSnap, failedSnap, pendingSnap] = await Promise.all([
      collections.organizations.get(),
      collections.notifications.where("status", "==", NotificationStatus.SENT).count().get(),
      collections.notifications.where("status", "==", NotificationStatus.DELIVERED).count().get(),
      collections.notifications.where("status", "==", NotificationStatus.FAILED).count().get(),
      collections.notifications.where("status", "==", NotificationStatus.PENDING).count().get(),
    ]);

    const orgSummaries: AdminOrgSummary[] = [];
    let totalBorrowers = 0;
    let totalVehicles = 0;
    let totalUsers = 0;
    let mrr = 0;
    let activeCount = 0;
    let trialingCount = 0;

    // Track plan breakdown and status breakdown
    const planCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};

    for (const orgDoc of orgsSnap.docs) {
      const org = orgDoc.data();
      const orgId = orgDoc.id;

      const [borrowerSnap, vehicleSnap, userSnap] = await Promise.all([
        collections.borrowers.where("organizationId", "==", orgId).count().get(),
        collections.vehicles.where("organizationId", "==", orgId).count().get(),
        collections.users.where("organizationId", "==", orgId).count().get(),
      ]);

      const borrowerCount = borrowerSnap.data().count;
      const vehicleCount = vehicleSnap.data().count;
      const userCount = userSnap.data().count;

      totalBorrowers += borrowerCount;
      totalVehicles += vehicleCount;
      totalUsers += userCount;

      const stripe: StripeSubscriptionData | undefined = org.stripe;
      const plan = stripe?.plan ?? "NONE";
      const status = stripe?.status ?? "none";

      // Track status counts
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;

      if (status === "active" || status === "trialing") {
        const planKey = plan as keyof typeof PLAN_CONFIG;
        if (PLAN_CONFIG[planKey]) {
          mrr += PLAN_CONFIG[planKey].priceMonthly;
        }
        // Track plan counts (only for paying/trialing orgs)
        planCounts[plan] = (planCounts[plan] ?? 0) + 1;
      }
      if (status === "active") activeCount++;
      if (status === "trialing") trialingCount++;

      orgSummaries.push({
        id: orgId,
        name: org.name,
        type: org.type,
        plan,
        subscriptionStatus: status,
        borrowerCount,
        vehicleCount,
        userCount,
        createdAt: org.createdAt?.toMillis() ?? 0,
      });
    }

    // Build plan breakdown
    const planBreakdown: PlanBreakdown[] = Object.values(SubscriptionPlan).map((p) => {
      const count = planCounts[p] ?? 0;
      const price = PLAN_CONFIG[p]?.priceMonthly ?? 0;
      return { plan: p, priceMonthly: price, count, revenue: price * count };
    });

    return {
      organizations: orgSummaries,
      totals: {
        organizations: orgsSnap.size,
        borrowers: totalBorrowers,
        vehicles: totalVehicles,
        users: totalUsers,
        mrr,
        activeSubscriptions: activeCount,
        trialingSubscriptions: trialingCount,
      },
      revenue: {
        planBreakdown,
        statusBreakdown: statusCounts,
      },
      notifications: {
        sent: sentSnap.data().count,
        delivered: deliveredSnap.data().count,
        failed: failedSnap.data().count,
        pending: pendingSnap.data().count,
      },
    };
  }
);
