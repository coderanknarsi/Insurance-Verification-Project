import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { requireSuperAdmin } from "../middleware/auth";

const BATCH_SIZE = 400;

async function deleteQueryInBatches(
  query: FirebaseFirestore.Query,
): Promise<number> {
  let deleted = 0;
  let snap = await query.limit(BATCH_SIZE).get();

  while (!snap.empty) {
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snap.size;
    snap = await query.limit(BATCH_SIZE).get();
  }

  return deleted;
}

export const deleteOrganization = onCall(async (request) => {
  requireSuperAdmin(request);

  const data = request.data as { organizationId?: string };
  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  const orgId = data.organizationId;

  // Prevent deleting demo org accidentally
  if (orgId === "demo-org") {
    throw new HttpsError(
      "failed-precondition",
      "Cannot delete the demo organization. Use the daily reset instead.",
    );
  }

  const orgDoc = await collections.organizations.doc(orgId).get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }

  // 1. Collect Firebase Auth UIDs from users collection before deleting
  const usersSnap = await collections.users
    .where("organizationId", "==", orgId)
    .get();
  const authUids = usersSnap.docs
    .map((d) => d.data().firebaseAuthUid)
    .filter(Boolean);

  // 2. Delete all org-scoped documents across collections
  const counts: Record<string, number> = {};

  counts.policies = await deleteQueryInBatches(
    collections.policies.where("organizationId", "==", orgId),
  );
  counts.vehicles = await deleteQueryInBatches(
    collections.vehicles.where("organizationId", "==", orgId),
  );
  counts.borrowers = await deleteQueryInBatches(
    collections.borrowers.where("organizationId", "==", orgId),
  );
  counts.notifications = await deleteQueryInBatches(
    collections.notifications.where("organizationId", "==", orgId),
  );
  counts.invites = await deleteQueryInBatches(
    collections.invites.where("organizationId", "==", orgId),
  );
  counts.auditLog = await deleteQueryInBatches(
    collections.auditLog.where("organizationId", "==", orgId),
  );
  counts.users = await deleteQueryInBatches(
    collections.users.where("organizationId", "==", orgId),
  );

  // 3. Delete carrier credentials subcollection
  counts.carrierCredentials = await deleteQueryInBatches(
    db.collection("organizations").doc(orgId).collection("carrierCredentials"),
  );

  // 4. Delete intake tokens referencing this org
  counts.intakeTokens = await deleteQueryInBatches(
    db.collection("intakeTokens").where("organizationId", "==", orgId),
  );

  // 5. Delete the organization document itself
  await collections.organizations.doc(orgId).delete();

  // 6. Delete Firebase Auth users
  let authDeleted = 0;
  for (const uid of authUids) {
    try {
      await getAuth().deleteUser(uid);
      authDeleted++;
    } catch {
      // User may already be deleted or not exist
    }
  }

  return {
    success: true,
    organizationId: orgId,
    deleted: { ...counts, authUsers: authDeleted },
  };
});
