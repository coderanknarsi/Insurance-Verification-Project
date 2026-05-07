import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { db } from "../config/firebase";
import { requireAuth, requireOrg } from "../middleware/auth";
import { DashboardStatus, PolicyStatus, ComplianceIssue } from "../types/policy";
import {
  getPolicyVerificationState,
  VerificationState,
} from "../services/verification-eligibility";

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

  // Pre-load org's active carrier credentials once for verification state classification.
  const credsSnap = await db
    .collection("organizations")
    .doc(data.organizationId)
    .collection("carrierCredentials")
    .where("active", "==", true)
    .get();
  const activeCarriers = new Set(credsSnap.docs.map((d) => d.id));

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

          // Backfill complianceIssues for UNVERIFIED policies missing the field
          if (policy && policy.status === PolicyStatus.UNVERIFIED && (!policy.complianceIssues || policy.complianceIssues.length === 0)) {
            policy.complianceIssues = [ComplianceIssue.UNVERIFIED];
          }

          const verificationState = policy
            ? getPolicyVerificationState(
                policy as never,
                data.organizationId,
                activeCarriers,
              )
            : VerificationState.PENDING_UPLOAD;
          const lastVerifiedAtMs =
            policy?.lastVerifiedAt?.toMillis?.() ?? null;

          return { ...vehicle, policy, verificationState, lastVerifiedAt: lastVerifiedAtMs };
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

      // Borrower-level verification state — worst across vehicles.
      // Order (worst → best): PENDING_UPLOAD, INSURED_NO_CREDS, INSURED_UNSUPPORTED, INSURED_SUPPORTED
      const verificationStates = vehicles.map((v) => v.verificationState);
      const verificationState =
        verificationStates.includes(VerificationState.PENDING_UPLOAD)
          ? VerificationState.PENDING_UPLOAD
          : verificationStates.includes(VerificationState.INSURED_NO_CREDS)
            ? VerificationState.INSURED_NO_CREDS
            : verificationStates.includes(VerificationState.INSURED_UNSUPPORTED)
              ? VerificationState.INSURED_UNSUPPORTED
              : VerificationState.INSURED_SUPPORTED;
      const lastVerifiedAt = vehicles
        .map((v) => v.lastVerifiedAt)
        .filter((t): t is number => typeof t === "number")
        .sort((a, b) => b - a)[0] ?? null;

      return { ...borrower, vehicles, overallStatus, verificationState, lastVerifiedAt };
    })
  );

  // Filter by dashboardStatus if requested
  const filtered = data.dashboardStatus
    ? enriched.filter((b) => b.overallStatus === data.dashboardStatus)
    : enriched;

  // Attach last-contact summary per borrower (most recent notification).
  // One query for the whole org, then group in memory — avoids N+1.
  const SUCCESS_NOTIFICATION_STATUSES = new Set(["SENT", "DELIVERED", "COMPLETED"]);
  const lastContactByBorrower: Record<
    string,
    { trigger: string; channel: string; status: string; sentAt: number }
  > = {};
  if (filtered.length > 0) {
    const recentNotifSnap = await collections.notifications
      .where("organizationId", "==", data.organizationId)
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();
    const notificationsByBorrower: Record<
      string,
      Array<{ trigger: string; channel: string; status: string; sentAt: number }>
    > = {};
    for (const doc of recentNotifSnap.docs) {
      const n = doc.data();
      const borrowerId = n.borrowerId;
      if (!borrowerId) continue;
      (notificationsByBorrower[borrowerId] ||= []).push({
        trigger: n.trigger,
        channel: n.channel ?? n.type,
        status: n.status,
        sentAt: n.sentAt?.toMillis?.() ?? n.createdAt?.toMillis?.() ?? 0,
      });
    }

    for (const [borrowerId, notifications] of Object.entries(notificationsByBorrower)) {
      const successful = notifications.filter((n) =>
        SUCCESS_NOTIFICATION_STATUSES.has(n.status),
      );
      const candidates = successful.length > 0 ? successful : notifications;
      const primary = candidates[0];
      if (!primary) continue;

      let channel = primary.channel;
      if (SUCCESS_NOTIFICATION_STATUSES.has(primary.status)) {
        const siblingChannels = new Set(
          candidates
            .filter((n) =>
              n.trigger === primary.trigger &&
              Math.abs(n.sentAt - primary.sentAt) <= 60_000 &&
              SUCCESS_NOTIFICATION_STATUSES.has(n.status),
            )
            .map((n) => n.channel),
        );
        if (siblingChannels.has("EMAIL") && siblingChannels.has("SMS")) {
          channel = "BOTH";
        }
      }

      lastContactByBorrower[borrowerId] = {
        trigger: primary.trigger,
        channel,
        status: primary.status,
        sentAt: primary.sentAt,
      };
    }
  }

  const withLastContact = filtered.map((b) => ({
    ...b,
    lastContact: b.id ? lastContactByBorrower[b.id] ?? null : null,
  }));

  return {
    borrowers: withLastContact,
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

  const [greenSnap, yellowSnap, redSnap, totalBorrowersSnap, totalPoliciesSnap, awaitingCredsSnap, needsHelpSnap] = await Promise.all([
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
    collections.policies
      .where("organizationId", "==", data.organizationId)
      .count()
      .get(),
    collections.policies
      .where("organizationId", "==", data.organizationId)
      .where("awaitingCredentials", "==", true)
      .count()
      .get(),
    collections.borrowers
      .where("organizationId", "==", data.organizationId)
      .where("needsHelp", "==", true)
      .count()
      .get(),
  ]);

  const green = greenSnap.data().count;
  const yellow = yellowSnap.data().count;
  const red = redSnap.data().count;
  const totalPolicies = totalPoliciesSnap.data().count;
  const pendingIntake = awaitingCredsSnap.data().count;
  const needsHelp = needsHelpSnap.data().count;
  const onboardingComplete = Math.max(0, totalPolicies - pendingIntake);
  const onboardingCompletionRate =
    totalPolicies > 0 ? Math.round((onboardingComplete / totalPolicies) * 1000) / 10 : 0;
  // Conservative estimate: each automated intake saves staff ~12 minutes of
  // phone tag, voicemail, and manual data entry vs. the legacy workflow.
  const MINUTES_SAVED_PER_BORROWER = 12;
  const estimatedHoursSaved =
    Math.round(((onboardingComplete * MINUTES_SAVED_PER_BORROWER) / 60) * 10) / 10;

  return {
    green,
    yellow,
    red,
    actionRequired: yellow + red,
    totalBorrowers: totalBorrowersSnap.data().count,
    totalPolicies,
    pendingIntake,
    needsHelp,
    onboardingComplete,
    onboardingCompletionRate,
    estimatedHoursSaved,
  };
});
