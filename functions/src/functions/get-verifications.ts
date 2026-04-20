import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { UserRole } from "../types/user";

export const getVerifications = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const { organizationId } = request.data as { organizationId: string };

  if (!organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
  requireOrg(user, organizationId);

  // Fetch notifications for this org, ordered by creation date
  const notifSnap = await collections.notifications
    .where("organizationId", "==", organizationId)
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();

  if (notifSnap.empty) {
    return { verifications: [] };
  }

  // Gather unique borrower IDs to batch-fetch names
  const borrowerIds = [...new Set(notifSnap.docs.map((d) => d.data().borrowerId))];

  // Fetch borrowers in batches of 10 (Firestore 'in' limit)
  const borrowerMap: Record<string, { name: string; email: string; phone: string }> = {};
  for (let i = 0; i < borrowerIds.length; i += 10) {
    const chunk = borrowerIds.slice(i, i + 10);
    const bSnap = await collections.borrowers
      .where("__name__", "in", chunk)
      .get();
    for (const doc of bSnap.docs) {
      const b = doc.data();
      borrowerMap[doc.id] = {
        name: `${b.firstName} ${b.lastName}`,
        email: b.email ?? "",
        phone: b.phone ?? "",
      };
    }
  }

  const verifications = notifSnap.docs.map((doc) => {
    const n = doc.data();
    const borrower = borrowerMap[n.borrowerId] ?? { name: "Unknown", email: "", phone: "" };
    return {
      id: doc.id,
      borrowerName: borrower.name,
      borrowerEmail: borrower.email,
      borrowerPhone: borrower.phone,
      channel: n.type,
      trigger: n.trigger,
      status: n.status,
      content: n.content,
      createdAt: n.createdAt?.toMillis() ?? 0,
      sentAt: n.sentAt?.toMillis() ?? null,
    };
  });

  return { verifications };
});
