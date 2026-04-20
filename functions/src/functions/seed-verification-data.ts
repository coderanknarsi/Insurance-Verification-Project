import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { UserRole } from "../types/user";

/**
 * One-time seed function to populate verification notification records.
 * Call once then remove.
 */
export const seedVerificationData = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const { organizationId } = request.data as { organizationId: string };

  if (!organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  requireRole(user, UserRole.ADMIN);
  requireOrg(user, organizationId);

  // Fetch all borrowers for this org
  const borrowersSnap = await db
    .collection("borrowers")
    .where("organizationId", "==", organizationId)
    .get();

  if (borrowersSnap.empty) {
    throw new HttpsError("not-found", "No borrowers found for this organization.");
  }

  const borrowers = borrowersSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  const now = Date.now();
  const day = 86400000;
  const hour = 3600000;

  const records: Array<Record<string, unknown>> = [];

  // Create realistic verification records spread over time
  const scenarios = [
    { daysAgo: 0, hoursAgo: 2, type: "EMAIL", trigger: "LAPSE_DETECTED", status: "SENT" },
    { daysAgo: 1, hoursAgo: 0, type: "EMAIL", trigger: "EXPIRING_SOON", status: "SENT" },
    { daysAgo: 2, hoursAgo: 5, type: "EMAIL", trigger: "LAPSE_DETECTED", status: "DELIVERED" },
    { daysAgo: 3, hoursAgo: 0, type: "EMAIL", trigger: "LAPSE_DETECTED", status: "FAILED" },
    { daysAgo: 4, hoursAgo: 3, type: "EMAIL", trigger: "REINSTATEMENT_REMINDER", status: "SENT" },
    { daysAgo: 5, hoursAgo: 0, type: "SMS", trigger: "EXPIRING_SOON", status: "PENDING" },
    { daysAgo: 7, hoursAgo: 1, type: "EMAIL", trigger: "EXPIRING_SOON", status: "SENT" },
    { daysAgo: 10, hoursAgo: 4, type: "EMAIL", trigger: "LAPSE_DETECTED", status: "SENT" },
    { daysAgo: 14, hoursAgo: 0, type: "EMAIL", trigger: "LAPSE_DETECTED", status: "DELIVERED" },
    { daysAgo: 21, hoursAgo: 2, type: "EMAIL", trigger: "LAPSE_DETECTED", status: "SENT" },
    { daysAgo: 6, hoursAgo: 0, type: "EMAIL", trigger: "EXPIRING_SOON", status: "SENT" },
    { daysAgo: 8, hoursAgo: 6, type: "SMS", trigger: "LAPSE_DETECTED", status: "PENDING" },
    { daysAgo: 12, hoursAgo: 0, type: "EMAIL", trigger: "REINSTATEMENT_REMINDER", status: "DELIVERED" },
    { daysAgo: 15, hoursAgo: 3, type: "EMAIL", trigger: "LAPSE_DETECTED", status: "FAILED" },
    { daysAgo: 18, hoursAgo: 0, type: "EMAIL", trigger: "EXPIRING_SOON", status: "SENT" },
    { daysAgo: 1, hoursAgo: 8, type: "SMS", trigger: "LAPSE_DETECTED", status: "SENT" },
  ];

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const borrower = borrowers[i % borrowers.length] as Record<string, unknown>;
    const ts = now - s.daysAgo * day - s.hoursAgo * hour;
    const recipient =
      s.type === "EMAIL"
        ? (borrower.email as string) ?? "unknown@example.com"
        : (borrower.phone as string) ?? "+10000000000";

    const rec: Record<string, unknown> = {
      borrowerId: borrower.id,
      organizationId,
      type: s.type,
      trigger: s.trigger,
      status: s.status,
      content: `Insurance verification link ${s.status === "SENT" || s.status === "DELIVERED" ? "sent" : s.status === "FAILED" ? "failed" : "generated"} for ${recipient}`,
      createdAt: Timestamp.fromMillis(ts),
    };

    if (s.status === "SENT" || s.status === "DELIVERED") {
      rec.sentAt = Timestamp.fromMillis(ts);
    }

    records.push(rec);
  }

  // Write in a batch
  const batch = db.batch();
  for (const rec of records) {
    const ref = db.collection("notifications").doc();
    batch.set(ref, rec);
  }
  await batch.commit();

  return { created: records.length };
});
