import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { requireSuperAdmin } from "../middleware/auth";
import { shapeAttempts, RawAttempt } from "../services/verification-history";

export const getAdminBorrowerDetail = onCall(
  { region: "us-central1" },
  async (request) => {
    requireSuperAdmin(request);

    const { organizationId, borrowerId } = request.data as {
      organizationId?: string;
      borrowerId?: string;
    };
    if (!organizationId || !borrowerId) {
      throw new HttpsError(
        "invalid-argument",
        "organizationId and borrowerId are required.",
      );
    }

    const borrowerSnap = await collections.borrowers.doc(borrowerId).get();
    if (
      !borrowerSnap.exists ||
      borrowerSnap.data()?.organizationId !== organizationId
    ) {
      throw new HttpsError(
        "not-found",
        "Borrower not found in this organization.",
      );
    }
    const borrower = borrowerSnap.data()!;

    // Policies for this borrower.
    const policiesSnap = await collections.policies
      .where("organizationId", "==", organizationId)
      .where("borrowerId", "==", borrowerId)
      .get();

    const policies = await Promise.all(
      policiesSnap.docs.map(async (doc) => {
        const p = doc.data();
        // Attempt history across all runs for this policy.
        const resultsSnap = await db
          .collectionGroup("results")
          .where("policyId", "==", doc.id)
          .orderBy("createdAt", "desc")
          .limit(25)
          .get();
        const raw: RawAttempt[] = resultsSnap.docs.map((r) => {
          const d = r.data();
          return {
            policyId: doc.id,
            success: d.success,
            errorReason: d.errorReason ?? null,
            durationMs: d.durationMs ?? null,
            createdAtMs: d.createdAt?.toMillis?.() ?? 0,
            screenshotPaths: d.screenshotPaths ?? [],
          };
        });
        return {
          id: doc.id,
          carrierName: p.insuranceProvider ?? null,
          policyNumber: p.policyNumber ?? null,
          status: p.status ?? null,
          dashboardStatus: p.dashboardStatus ?? null,
          complianceIssues: p.complianceIssues ?? [],
          lastVerifiedAtMs: p.lastVerifiedAt?.toMillis?.() ?? null,
          lastVerificationError: p.lastVerificationError ?? null,
          verificationSource:
            (p as { verificationSource?: string }).verificationSource ?? null,
          attempts: shapeAttempts(raw),
        };
      }),
    );

    // This borrower's notification log (delivery proof).
    const notifSnap = await collections.notifications
      .where("organizationId", "==", organizationId)
      .where("borrowerId", "==", borrowerId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();
    const notifications = notifSnap.docs.map((d) => {
      const n = d.data();
      return {
        id: d.id,
        type: n.type,
        channel: n.channel ?? n.type,
        trigger: n.trigger,
        status: n.status,
        content: n.content,
        createdAtMs: n.createdAt?.toMillis?.() ?? 0,
      };
    });

    return {
      borrower: {
        id: borrowerId,
        firstName: borrower.firstName,
        lastName: borrower.lastName,
        email: borrower.email ?? null,
        phone: borrower.phone ?? null,
      },
      policies,
      notifications,
    };
  },
);
