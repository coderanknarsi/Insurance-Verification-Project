import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { collections } from "../config/firestore";
import { db } from "../config/firebase";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { UserRole } from "../types/user";
import {
  getPolicyVerificationState,
  VerificationState,
} from "../services/verification-eligibility";
import { isWithinSendingHours } from "../services/telnyx";
import {
  createIntakeTokenAndNotify,
  type IntakeNotifyInput,
} from "../services/intake-token";

export interface KickoffResponse {
  status: "queued" | "sent";
  /** Number of borrowers contacted in this call (0 if queued for later flush). */
  sentCount: number;
  /** Number of eligible borrowers found (regardless of whether sent now). */
  eligibleCount: number;
  /** Skip reasons grouped by category. */
  skipped: {
    alreadyInsured: number;
    recentlyContacted: number;
    noContactMethod: number;
    deliveryFailed: number;
  };
}

const RECENT_CONTACT_HOURS = 24;
const SEND_THROTTLE_MS = 200; // 5/sec

/**
 * Org-wide intake kickoff. Called once when an org finishes onboarding —
 * fans out intake requests to every eligible borrower whose policy is in
 * PENDING_UPLOAD state.
 *
 * Behaviour:
 *  - If outside the org's quiet-hours window, marks the org with
 *    `kickoffPendingAt` and returns `status="queued"`. The daily reminder
 *    cron flushes pending kickoffs.
 *  - Otherwise sends immediately, throttled at 5 messages/sec.
 *  - Borrowers contacted within the last 24h are skipped (idempotent).
 */
export const onOrgOnboardingComplete = onCall(
  { region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (request): Promise<KickoffResponse> => {
    const { user } = await requireAuth(request);
    const data = request.data as { organizationId: string } | undefined;
    if (!data?.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required");
    }
    requireRole(user, UserRole.ADMIN);
    requireOrg(user, data.organizationId);

    return await kickoffOrgIntake(data.organizationId, /*forceSend*/ false);
  },
);

/**
 * Internal entry point shared by the callable and the daily-flush cron.
 * `forceSend=true` bypasses the quiet-hours guard.
 */
export async function kickoffOrgIntake(
  organizationId: string,
  forceSend: boolean,
): Promise<KickoffResponse> {
  const orgDoc = await db.collection("organizations").doc(organizationId).get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }
  const orgData = orgDoc.data()!;
  const orgTimezone: string | undefined =
    orgData.settings?.complianceRules?.timezone;
  const dealershipName: string = orgData.name ?? "Your Lender";

  if (!forceSend && !isWithinSendingHours(orgTimezone)) {
    await orgDoc.ref.update({ kickoffPendingAt: Timestamp.now() });
    logger.info(
      `[kickoff] Outside sending hours for org=${organizationId}; queued.`,
    );
    return {
      status: "queued",
      sentCount: 0,
      eligibleCount: 0,
      skipped: {
        alreadyInsured: 0,
        recentlyContacted: 0,
        noContactMethod: 0,
        deliveryFailed: 0,
      },
    };
  }

  // Active master creds (set of carrier ids) — needed to classify state
  const credsSnap = await db
    .collection("organizations")
    .doc(organizationId)
    .collection("carrierCredentials")
    .where("active", "==", true)
    .get();
  const activeCarriers = new Set(credsSnap.docs.map((d) => d.id));

  const policiesSnap = await collections.policies
    .where("organizationId", "==", organizationId)
    .get();

  const skipped = {
    alreadyInsured: 0,
    recentlyContacted: 0,
    noContactMethod: 0,
    deliveryFailed: 0,
  };
  let sentCount = 0;
  let eligibleCount = 0;

  const cutoff = Timestamp.fromDate(
    new Date(Date.now() - RECENT_CONTACT_HOURS * 60 * 60 * 1000),
  );

  for (const policyDoc of policiesSnap.docs) {
    const policy = policyDoc.data();
    const state = getPolicyVerificationState(
      policy as never,
      organizationId,
      activeCarriers,
    );

    if (state !== VerificationState.PENDING_UPLOAD) {
      skipped.alreadyInsured++;
      continue;
    }
    eligibleCount++;

    // 24h idempotency — skip borrowers we've contacted recently
    const recentTouch = await collections.notifications
      .where("borrowerId", "==", policy.borrowerId)
      .where("organizationId", "==", organizationId)
      .where("createdAt", ">=", cutoff)
      .limit(1)
      .get();
    if (!recentTouch.empty) {
      skipped.recentlyContacted++;
      continue;
    }

    const borrowerSnap = await collections.borrowers
      .doc(policy.borrowerId)
      .get();
    if (!borrowerSnap.exists) continue;
    const b = borrowerSnap.data()!;

    const vehicleSnap = await collections.vehicles
      .doc(policy.vehicleId)
      .get();
    if (!vehicleSnap.exists) continue;
    const v = vehicleSnap.data()!;
    const vehicleLabel = `${v.year} ${v.make} ${v.model}`;

    const input: IntakeNotifyInput = {
      organizationId,
      borrower: {
        id: policy.borrowerId,
        firstName: b.firstName,
        lastName: b.lastName,
        email: b.email,
        phone: b.phone,
        smsConsentStatus: b.smsConsentStatus,
      },
      vehicleId: policy.vehicleId,
      vehicleLabel,
      policyId: policyDoc.id,
      dealershipName,
      orgTimezone,
    };

    const result = await createIntakeTokenAndNotify(input);
    if (result.deliveryMethod === "none") {
      skipped.noContactMethod++;
    } else if (!result.delivered) {
      skipped.deliveryFailed++;
    } else {
      sentCount++;
    }

    // Throttle to 5/sec to avoid hammering Telnyx/Resend
    await new Promise((r) => setTimeout(r, SEND_THROTTLE_MS));
  }

  await orgDoc.ref.update({
    kickoffPendingAt: null,
    lastKickoffAt: Timestamp.now(),
  });

  logger.info(`[kickoff] org=${organizationId} sent=${sentCount}`, {
    eligibleCount,
    skipped,
  });

  return {
    status: "sent",
    sentCount,
    eligibleCount,
    skipped,
  };
}
