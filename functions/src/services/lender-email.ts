import { logger } from "firebase-functions/v2";
import { collections } from "../config/firestore";
import { UserRole } from "../types/user";

/**
 * Returns the email address that should receive lender-side alerts for an org.
 * Looks for the first ADMIN user in the org, falling back to any user.
 */
export async function getLenderAlertEmail(
  organizationId: string,
): Promise<string | null> {
  try {
    const adminSnap = await collections.users
      .where("organizationId", "==", organizationId)
      .where("role", "==", UserRole.ADMIN)
      .limit(1)
      .get();
    if (!adminSnap.empty) {
      const email = adminSnap.docs[0].data().email;
      if (email) return email as string;
    }
    const anySnap = await collections.users
      .where("organizationId", "==", organizationId)
      .limit(1)
      .get();
    if (!anySnap.empty) {
      const email = anySnap.docs[0].data().email;
      if (email) return email as string;
    }
  } catch (err) {
    logger.warn("[lender-email] lookup failed", {
      organizationId,
      err: String(err),
    });
  }
  return null;
}
