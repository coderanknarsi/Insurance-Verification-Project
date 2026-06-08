import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg, isSuperAdmin } from "../middleware/auth";
import { UserRole } from "../types/user";
import {
  getPolicyVerificationState,
  normalizeCarrier,
  hasOperatorAdapter,
  VerificationState,
} from "../services/verification-eligibility";

/**
 * Portfolio-wide one-click sweep.
 *
 * Unlike `startManualCarrierSweep` (one carrier per run), this gathers the
 * org's ENTIRE eligible book into a single run whose `policyQueue` items each
 * carry their own `carrierId`. The operator processes the mixed queue
 * carrier-by-carrier, switching portals as needed.
 *
 * Policies whose carrier has no real operator adapter (unsupported carriers
 * like Farmers, plus stub carriers such as GEICO/Allstate) are NOT queued for
 * the operator — they are returned as a manual-verification list so the dealer
 * can confirm coverage from the carrier's lienholder mailers / EOI.
 */

interface StartPortfolioSweepRequest {
  organizationId: string;
}

interface PortfolioQueueItem {
  policyId: string;
  vin: string;
  borrowerLastName: string;
  borrowerFirstName: string | null;
  policyNumber: string | null;
  insuranceProvider: string | null;
  carrierId: string;
}

interface ManualReviewItem {
  policyId: string;
  borrowerName: string;
  insuranceProvider: string | null;
  policyNumber: string | null;
  vin: string | null;
  reason: "unsupported_carrier" | "no_adapter";
}

interface StartPortfolioSweepResponse {
  runId: string;
  totalPolicies: number;
  carriersToLogin: string[];
  policyQueue: PortfolioQueueItem[];
  manualReview: ManualReviewItem[];
  manualReviewCount: number;
}

export const startPortfolioSweep = onCall(
  { region: "us-central1", timeoutSeconds: 120, memory: "256MiB" },
  async (request): Promise<StartPortfolioSweepResponse> => {
    const { user, uid } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as StartPortfolioSweepRequest | undefined;
    if (!data?.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required");
    }
    const orgId = data.organizationId;
    if (!isSuperAdmin(request)) {
      requireOrg(user, orgId);
    }

    // Carriers the org holds active master creds for (drives verification state).
    const credsSnap = await db
      .collection("masterCredentials")
      .where("active", "==", true)
      .get();
    const activeCarriers = new Set(
      credsSnap.docs.flatMap((doc) => {
        const d = doc.data() as { carrierId?: string; carrierName?: string };
        return [doc.id, d.carrierId, d.carrierName]
          .map((v) => normalizeCarrier(v))
          .filter(Boolean);
      }),
    );

    const policiesSnap = await collections.policies
      .where("organizationId", "==", orgId)
      .get();

    const policyQueue: PortfolioQueueItem[] = [];
    const manualReview: ManualReviewItem[] = [];

    for (const policyDoc of policiesSnap.docs) {
      const p = policyDoc.data();
      const carrier = normalizeCarrier(p.insuranceProvider);

      // No carrier on file yet → intake-chase handles it, not a sweep.
      if (!carrier) continue;

      const [vehicleSnap, borrowerSnap] = await Promise.all([
        p.vehicleId ? collections.vehicles.doc(p.vehicleId).get() : Promise.resolve(null),
        p.borrowerId ? collections.borrowers.doc(p.borrowerId).get() : Promise.resolve(null),
      ]);
      const vehicle = vehicleSnap?.data();
      const borrower = borrowerSnap?.data();
      const borrowerName =
        [borrower?.firstName, borrower?.lastName].filter(Boolean).join(" ") ||
        "Unknown borrower";

      // Carrier has no real operator adapter → manual-verification worklist.
      if (!hasOperatorAdapter(carrier)) {
        const state = getPolicyVerificationState(p, orgId, activeCarriers);
        manualReview.push({
          policyId: policyDoc.id,
          borrowerName,
          insuranceProvider: p.insuranceProvider ?? null,
          policyNumber: p.policyNumber ?? null,
          vin: vehicle?.vin ?? null,
          reason:
            state === VerificationState.INSURED_UNSUPPORTED
              ? "unsupported_carrier"
              : "no_adapter",
        });
        continue;
      }

      // Adapter-ready carrier: include if the policy is in a sweepable state and
      // has the data the operator needs (VIN + borrower last name).
      const state = getPolicyVerificationState(p, orgId, activeCarriers);
      if (
        state !== VerificationState.INSURED_SUPPORTED &&
        state !== VerificationState.INSURED_NO_CREDS
      ) {
        continue;
      }
      if (!vehicle?.vin || !borrower?.lastName) continue;

      policyQueue.push({
        policyId: policyDoc.id,
        vin: vehicle.vin,
        borrowerLastName: borrower.lastName,
        borrowerFirstName: borrower.firstName ?? null,
        policyNumber: p.policyNumber ?? null,
        insuranceProvider: p.insuranceProvider ?? null,
        carrierId: carrier,
      });
    }

    // Sort by carrier so the operator minimizes portal switches.
    policyQueue.sort((a, b) => a.carrierId.localeCompare(b.carrierId));

    const carriersToLogin = Array.from(
      new Set(policyQueue.map((q) => q.carrierId)),
    ).sort();

    const runId = `portfolio_${Date.now()}_${orgId}`;
    await db.collection("dataFeedRuns").doc(runId).set({
      runId,
      status: "awaiting_operator",
      mode: "manual-operator",
      scope: "portfolio",
      carrierId: "portfolio", // mixed-carrier run; per-policy carrierId on queue
      triggeredBy: "manual-operator",
      startedAt: FieldValue.serverTimestamp(),
      orgsProcessed: [orgId],
      organizationId: orgId,
      createdBy: uid,
      totalPolicies: policyQueue.length,
      successCount: 0,
      errorCount: 0,
      carriersToLogin,
      manualReviewCount: manualReview.length,
      policyQueue,
    });

    logger.info(
      `[portfolio-sweep] Start runId=${runId} org=${orgId} queued=${policyQueue.length} manual=${manualReview.length} carriers=${carriersToLogin.join(",")} by=${uid}`,
    );

    // Running a sweep clears today's reminder banner for the org.
    await db
      .collection("sweepReminders")
      .doc(orgId)
      .set(
        { acknowledged: true, acknowledgedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
      .catch(() => undefined);

    return {
      runId,
      totalPolicies: policyQueue.length,
      carriersToLogin,
      policyQueue,
      manualReview,
      manualReviewCount: manualReview.length,
    };
  },
);
