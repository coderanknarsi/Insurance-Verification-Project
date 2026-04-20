import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { UserRole } from "../types/user";
import { InviteStatus } from "../types/invite";
import { sendTeamInviteEmail } from "../services/email";
import { logger } from "firebase-functions/v2";
import { DEMO_ORG_ID } from "../constants";

export const inviteTeamMember = onCall(async (request) => {
  const { user, uid } = await requireAuth(request);
  const data = request.data as {
    organizationId: string;
    email: string;
    role: string;
  };

  if (!data.organizationId || !data.email || !data.role) {
    throw new HttpsError("invalid-argument", "organizationId, email, and role are required.");
  }

  requireRole(user, UserRole.ADMIN);
  requireOrg(user, data.organizationId);

  if (data.organizationId === DEMO_ORG_ID) {
    throw new HttpsError("permission-denied", "Team management is disabled for demo accounts. Sign up for your own free trial!");
  }

  // Validate role — can't invite as ADMIN
  if (data.role !== UserRole.MANAGER && data.role !== UserRole.VIEWER) {
    throw new HttpsError("invalid-argument", "Role must be MANAGER or VIEWER.");
  }

  const email = data.email.toLowerCase().trim();

  // Check if user already exists in this org
  const existingUsers = await collections.users
    .where("email", "==", email)
    .where("organizationId", "==", data.organizationId)
    .limit(1)
    .get();

  if (!existingUsers.empty) {
    throw new HttpsError("already-exists", "This person is already a member of your organization.");
  }

  // Check if there's already a pending invite for this email in this org
  const existingInvites = await collections.invites
    .where("email", "==", email)
    .where("organizationId", "==", data.organizationId)
    .where("status", "==", InviteStatus.PENDING)
    .limit(1)
    .get();

  if (!existingInvites.empty) {
    throw new HttpsError("already-exists", "There is already a pending invite for this email.");
  }

  // Get org name for the email
  const orgSnap = await collections.organizations.doc(data.organizationId).get();
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }
  const orgName = orgSnap.data()!.name;

  // Create the invite
  const token = randomUUID();
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const inviteRef = collections.invites.doc();
  await inviteRef.set({
    organizationId: data.organizationId,
    email,
    role: data.role as UserRole,
    token,
    status: InviteStatus.PENDING,
    invitedBy: uid,
    invitedByEmail: user.email,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  // Send invite email
  try {
    await sendTeamInviteEmail({
      to: email,
      inviterName: user.displayName,
      organizationName: orgName,
      role: data.role,
      inviteUrl: `https://app.autolientracker.com?invite=${token}`,
    });
  } catch (err) {
    logger.error("Failed to send invite email", err);
    // Don't fail the invite — it's still in Firestore
  }

  logger.info(`Invite sent: ${email} to org ${data.organizationId} as ${data.role}`);

  return { inviteId: inviteRef.id, email, role: data.role };
});

export const getTeamMembers = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as { organizationId: string };

  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  requireOrg(user, data.organizationId);

  // Get all users in the org
  const usersSnap = await collections.users
    .where("organizationId", "==", data.organizationId)
    .get();

  const members = usersSnap.docs.map((doc) => {
    const u = doc.data();
    return {
      id: doc.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      type: "member" as const,
      createdAt: u.createdAt.toMillis(),
    };
  });

  // Get pending invites
  const invitesSnap = await collections.invites
    .where("organizationId", "==", data.organizationId)
    .where("status", "==", InviteStatus.PENDING)
    .get();

  const now = Date.now();
  const invites = invitesSnap.docs
    .filter((doc) => doc.data().expiresAt.toMillis() > now) // skip expired
    .map((doc) => {
      const inv = doc.data();
      return {
        id: doc.id,
        email: inv.email,
        displayName: "",
        role: inv.role,
        type: "invite" as const,
        createdAt: inv.createdAt.toMillis(),
        expiresAt: inv.expiresAt.toMillis(),
        invitedBy: inv.invitedByEmail,
      };
    });

  return { members, invites };
});

export const revokeInvite = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as {
    organizationId: string;
    inviteId: string;
  };

  if (!data.organizationId || !data.inviteId) {
    throw new HttpsError("invalid-argument", "organizationId and inviteId are required.");
  }

  requireRole(user, UserRole.ADMIN);
  requireOrg(user, data.organizationId);

  const inviteSnap = await collections.invites.doc(data.inviteId).get();
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "Invite not found.");
  }

  const invite = inviteSnap.data()!;
  if (invite.organizationId !== data.organizationId) {
    throw new HttpsError("permission-denied", "Invite does not belong to your organization.");
  }

  if (invite.status !== InviteStatus.PENDING) {
    throw new HttpsError("failed-precondition", "Only pending invites can be revoked.");
  }

  await collections.invites.doc(data.inviteId).update({
    status: InviteStatus.REVOKED,
    updatedAt: Timestamp.now(),
  });

  return { success: true };
});

export const removeTeamMember = onCall(async (request) => {
  const { user, uid } = await requireAuth(request);
  const data = request.data as {
    organizationId: string;
    userId: string;
  };

  if (!data.organizationId || !data.userId) {
    throw new HttpsError("invalid-argument", "organizationId and userId are required.");
  }

  requireRole(user, UserRole.ADMIN);
  requireOrg(user, data.organizationId);

  // Can't remove yourself
  if (data.userId === uid) {
    throw new HttpsError("failed-precondition", "You cannot remove yourself from the organization.");
  }

  const targetSnap = await collections.users.doc(data.userId).get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "User not found.");
  }

  const target = targetSnap.data()!;
  if (target.organizationId !== data.organizationId) {
    throw new HttpsError("permission-denied", "User does not belong to your organization.");
  }

  // Don't allow removing another admin
  if (target.role === UserRole.ADMIN) {
    throw new HttpsError("failed-precondition", "Cannot remove another admin.");
  }

  await collections.users.doc(data.userId).delete();

  logger.info(`User ${data.userId} removed from org ${data.organizationId} by ${uid}`);

  return { success: true };
});
