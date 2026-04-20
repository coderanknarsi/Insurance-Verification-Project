import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { UserRole } from "../types/user";
import { InviteStatus } from "../types/invite";
import { OrganizationType, NotificationPreference, SubscriptionTier } from "../types/organization";
import { SubscriptionPlan } from "../types/subscription";
import { logger } from "firebase-functions/v2";
import { sendAdminAlertEmail } from "../services/email";
import { getBootstrapOrganizationName } from "./organization-profile";

/**
 * Returns the authenticated user's profile (org ID, role, etc.)
 * On first call after signup, creates the org + user docs automatically.
 * If an invite token is provided, joins the invited org instead.
 */
export const getUserProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const uid = request.auth.uid;
  const requestData = request.data as { inviteToken?: string; organizationName?: string };
  const inviteToken = requestData?.inviteToken;
  const userSnap = await collections.users.doc(uid).get();

  // ── Invite acceptance (new user with invite token) ──
  if (!userSnap.exists && inviteToken) {
    const inviteSnap = await collections.invites
      .where("token", "==", inviteToken)
      .where("status", "==", InviteStatus.PENDING)
      .limit(1)
      .get();

    if (!inviteSnap.empty) {
      const inviteDoc = inviteSnap.docs[0];
      const invite = inviteDoc.data();

      // Check expiry
      if (invite.expiresAt.toMillis() > Date.now()) {
        const now = Timestamp.now();
        const email = request.auth.token.email ?? "";
        const displayName = request.auth.token.name ?? email.split("@")[0] ?? "User";

        // Create user doc in the invited org
        await collections.users.doc(uid).set({
          organizationId: invite.organizationId,
          email,
          displayName,
          role: invite.role,
          firebaseAuthUid: uid,
          createdAt: now,
          updatedAt: now,
        });

        // Mark invite as accepted
        await collections.invites.doc(inviteDoc.id).update({
          status: InviteStatus.ACCEPTED,
          acceptedAt: now,
          updatedAt: now,
        });

        logger.info(`Invite accepted: ${uid} joined org ${invite.organizationId} as ${invite.role}`);

        return {
          organizationId: invite.organizationId,
          email,
          displayName,
          role: invite.role,
        };
      }
    }
    // If invite is invalid/expired, fall through to create a fresh org
  }

  // ── Existing user returning (may want to accept invite into existing account) ──
  if (userSnap.exists && inviteToken) {
    const inviteSnap = await collections.invites
      .where("token", "==", inviteToken)
      .where("status", "==", InviteStatus.PENDING)
      .limit(1)
      .get();

    if (!inviteSnap.empty) {
      const inviteDoc = inviteSnap.docs[0];
      const invite = inviteDoc.data();

      if (invite.expiresAt.toMillis() > Date.now()) {
        const now = Timestamp.now();

        // Move user to the new org
        await collections.users.doc(uid).update({
          organizationId: invite.organizationId,
          role: invite.role,
          updatedAt: now,
        });

        await collections.invites.doc(inviteDoc.id).update({
          status: InviteStatus.ACCEPTED,
          acceptedAt: now,
          updatedAt: now,
        });

        logger.info(`Existing user ${uid} accepted invite to org ${invite.organizationId}`);

        const existingUser = userSnap.data()!;
        return {
          organizationId: invite.organizationId,
          email: existingUser.email,
          displayName: existingUser.displayName,
          role: invite.role,
        };
      }
    }
    // Invalid invite — return current profile
  }

  // ── First login, no invite — bootstrap new org ──
  if (!userSnap.exists) {
    const now = Timestamp.now();
    const email = request.auth.token.email ?? "";
    const displayName = request.auth.token.name ?? email.split("@")[0] ?? "User";

    const orgRef = collections.organizations.doc();
    const orgName = getBootstrapOrganizationName(requestData?.organizationName, displayName);

    await orgRef.set({
      name: orgName,
      type: OrganizationType.BHPH_DEALER,
      address: { street: "", city: "", state: "", zip: "" },
      settings: {
        notificationPreference: NotificationPreference.AUTO_NOTIFY_BORROWER,
        lapseGracePeriodDays: 5,
        expirationWarningDays: 15,
        complianceRules: {
          requireLienholder: true,
          requireComprehensive: true,
          requireCollision: true,
          expirationWarningDays: 15,
          lapseGracePeriodDays: 5,
          autoSendReminder: false,
          reminderDaysBeforeExpiry: 10,
        },
      },
      subscription: {
        tier: SubscriptionTier.STARTER,
        perBorrowerRate: 3.0,
        activeMonitoredCount: 0,
      },
      stripe: {
        stripeCustomerId: "",
        plan: SubscriptionPlan.STARTER,
        status: "trialing",
        trialEnd: Math.floor(Date.now() / 1000) + 14 * 86400,
        cancelAtPeriodEnd: false,
      },
      createdAt: now,
      updatedAt: now,
    });

    await collections.users.doc(uid).set({
      organizationId: orgRef.id,
      email,
      displayName,
      role: UserRole.ADMIN,
      firebaseAuthUid: uid,
      createdAt: now,
      updatedAt: now,
    });

    logger.info(`New user bootstrapped: ${uid}, org: ${orgRef.id}`);

    sendAdminAlertEmail(
      `New Signup — ${orgName}`,
      "\ud83c\udf89 New Organization Signed Up",
      `<p style="margin:0 0 8px;font-size:14px;color:#e2e8f0;"><strong>Organization:</strong> ${orgName}</p>
       <p style="margin:0 0 8px;font-size:14px;color:#e2e8f0;"><strong>User:</strong> ${displayName}</p>
       <p style="margin:0 0 8px;font-size:14px;color:#e2e8f0;"><strong>Email:</strong> ${email}</p>
       <p style="margin:0;font-size:14px;color:#e2e8f0;"><strong>Plan:</strong> Starter (14-day trial)</p>`
    ).catch((err) => logger.error("Admin alert email failed:", err));

    return {
      organizationId: orgRef.id,
      email,
      displayName,
      role: UserRole.ADMIN,
    };
  }

  // ── Existing user, no invite — return profile ──
  const user = userSnap.data()!;
  return {
    organizationId: user.organizationId,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
});
