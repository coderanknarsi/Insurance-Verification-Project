import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { requireAuth, requireOrg } from "../middleware/auth";

export const getBorrowerAuditLog = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as {
    organizationId: string;
    borrowerId: string;
  };

  if (!data.organizationId || !data.borrowerId) {
    throw new HttpsError(
      "invalid-argument",
      "organizationId and borrowerId are required."
    );
  }

  requireOrg(user, data.organizationId);

  // Fetch audit entries related to this borrower (direct + policy changes)
  const auditSnap = await collections.auditLog
    .where("organizationId", "==", data.organizationId)
    .where("entityId", "==", data.borrowerId)
    .orderBy("timestamp", "desc")
    .limit(50)
    .get();

  const entries = auditSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return { entries };
});
