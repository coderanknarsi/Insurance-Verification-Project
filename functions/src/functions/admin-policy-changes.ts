import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { requireSuperAdmin } from "../middleware/auth";
import type { Timestamp } from "firebase-admin/firestore";

/**
 * Returns the policy-change timeline for a borrower's policy (super-admin only).
 * Used by the admin borrower-support console to show the lifecycle history
 * (carrier switches, downgrades, lapses, reinstatements, etc).
 */
export const getPolicyChanges = onCall(
  { region: "us-central1" },
  async (request) => {
    requireSuperAdmin(request);

    const { organizationId, policyId } = request.data as {
      organizationId?: string;
      policyId?: string;
    };
    if (!organizationId || !policyId) {
      throw new HttpsError(
        "invalid-argument",
        "organizationId and policyId are required.",
      );
    }

    const snap = await collections.policyChanges
      .where("organizationId", "==", organizationId)
      .where("policyId", "==", policyId)
      .get();

    const changes = snap.docs
      .map((doc) => {
        const d = doc.data() as {
          type?: string;
          severity?: string;
          summary?: string;
          createdAt?: Timestamp;
          notifiedAt?: Timestamp;
        };
        return {
          id: doc.id,
          type: d.type ?? "",
          severity: d.severity ?? "info",
          summary: d.summary ?? "",
          createdAt: d.createdAt ? d.createdAt.toMillis() : 0,
          notified: d.notifiedAt != null,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    return { changes };
  },
);
