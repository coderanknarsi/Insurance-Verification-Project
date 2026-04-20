import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { collections } from "../config/firestore";
import type { User } from "../types/user";
import { UserRole } from "../types/user";

const superAdminEmails = defineString("SUPER_ADMIN_EMAILS", { default: "" });

export interface AuthenticatedContext {
  uid: string;
  user: User;
}

/**
 * Validates that the caller is authenticated and has a user doc in Firestore.
 * Returns the Firebase Auth UID and the user's Firestore document.
 */
export async function requireAuth(
  request: CallableRequest
): Promise<AuthenticatedContext> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const uid = request.auth.uid;
  const userSnap = await collections.users.doc(uid).get();

  if (!userSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "No user profile found. Contact your administrator."
    );
  }

  return { uid, user: userSnap.data()! };
}

/**
 * Validates that the caller has one of the required roles.
 */
export function requireRole(
  user: User,
  ...roles: UserRole[]
): void {
  if (!roles.includes(user.role as UserRole)) {
    throw new HttpsError(
      "permission-denied",
      `Requires one of: ${roles.join(", ")}`
    );
  }
}

/**
 * Validates that the caller belongs to the specified organization.
 */
export function requireOrg(
  user: User,
  organizationId: string
): void {
  if (user.organizationId !== organizationId) {
    throw new HttpsError(
      "permission-denied",
      "You do not have access to this organization."
    );
  }
}

/**
 * Validates that the caller's email is in the SUPER_ADMIN_EMAILS env var.
 */
export function requireSuperAdmin(request: CallableRequest): void {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  const email = request.auth.token.email;
  if (!email) {
    throw new HttpsError("permission-denied", "Super admin access required.");
  }
  const allowed = superAdminEmails
    .value()
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(email.toLowerCase())) {
    throw new HttpsError("permission-denied", "Super admin access required.");
  }
}
