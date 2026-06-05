import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg, isSuperAdmin } from "../middleware/auth";
import { UserRole } from "../types/user";
import { PolicyStatus } from "../types/policy";
import {
  getPolicyVerificationState,
  normalizeCarrier,
  VerificationState,
} from "../services/verification-eligibility";
import {
  normalizeStateFarmScrape,
  type StateFarmScrapedPolicy,
} from "../services/state-farm-normalize";
import type { VerificationInput } from "./data-feed-types";

const CARRIER_ID = "state_farm";

interface StartSweepRequest {
  organizationId: string;
}

interface StartSweepResponse {
  runId: string;
  policies: VerificationInput[];
}

interface RecordResultRequest {
  runId: string;
  policyId: string;
  scraped?: StateFarmScrapedPolicy;
  error?: string;
  durationMs?: number;
}

interface FinalizeSweepRequest {
  runId: string;
  status?: "completed" | "cancelled" | "failed";
}

/**
 * Phase 1 of the dashboard-driven State Farm sweep.
 * The admin clicks "Start State Farm Sweep" in the dashboard, which calls
 * this function. We create the run document, assemble the policy work
 * list, and return both to the dashboard (which forwards to the Chrome
 * extension that does the actual portal work).
 */
export const startStateFarmSweep = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request): Promise<StartSweepResponse> => {
    const { user, uid } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as StartSweepRequest | undefined;
    if (!data?.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required");
    }
    if (!isSuperAdmin(request)) {
      requireOrg(user, data.organizationId);
    }

    const orgId = data.organizationId;

    // Load active master credentials so we can classify policies the same
    // way the scheduled dispatcher does.
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

    const inputs: VerificationInput[] = [];

    for (const policyDoc of policiesSnap.docs) {
      const p = policyDoc.data();
      if (normalizeCarrier(p.insuranceProvider) !== CARRIER_ID) continue;

      const state = getPolicyVerificationState(p, orgId, activeCarriers);
      // Allow INSURED_SUPPORTED *and* INSURED_NO_CREDS (this manual flow
      // doesn't need master credentials — the admin logs in themselves).
      if (
        state !== VerificationState.INSURED_SUPPORTED &&
        state !== VerificationState.INSURED_NO_CREDS
      ) {
        continue;
      }

      if (!p.vehicleId || !p.borrowerId) continue;

      const [vehicleSnap, borrowerSnap] = await Promise.all([
        collections.vehicles.doc(p.vehicleId).get(),
        collections.borrowers.doc(p.borrowerId).get(),
      ]);
      const vehicle = vehicleSnap.data();
      const borrower = borrowerSnap.data();
      if (!vehicle?.vin || !borrower?.lastName) continue;

      inputs.push({
        policyId: policyDoc.id,
        organizationId: orgId,
        borrowerId: p.borrowerId,
        vehicleId: p.vehicleId,
        vin: vehicle.vin,
        borrowerLastName: borrower.lastName,
        borrowerFirstName: borrower.firstName,
        policyNumber: p.policyNumber,
        insuranceProvider: p.insuranceProvider ?? "State Farm",
      });
    }

    const runId = `manual_${Date.now()}_${orgId}_${CARRIER_ID}`;
    await db.collection("dataFeedRuns").doc(runId).set({
      runId,
      status: "awaiting_extension",
      carrier: CARRIER_ID,
      triggeredBy: "manual-extension",
      startedAt: FieldValue.serverTimestamp(),
      orgsProcessed: [orgId],
      organizationId: orgId,
      createdBy: uid,
      totalPolicies: inputs.length,
      successCount: 0,
      errorCount: 0,
    });

    logger.info(
      `[state-farm-sweep] Start runId=${runId} org=${orgId} policies=${inputs.length} by=${uid}`,
    );

    return { runId, policies: inputs };
  },
);

/**
 * Called by the Chrome extension once for each VIN it processes.
 * Normalizes the scraped fields and updates the policy + the
 * dataFeedRuns/{runId}/results/{policyId} log doc.
 */
export const recordStateFarmSweepResult = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request): Promise<{ ok: true }> => {
    const { user, uid } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as RecordResultRequest | undefined;
    if (!data?.runId || !data.policyId) {
      throw new HttpsError(
        "invalid-argument",
        "runId and policyId are required",
      );
    }

    const runRef = db.collection("dataFeedRuns").doc(data.runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) {
      throw new HttpsError("not-found", `Run ${data.runId} not found`);
    }
    const run = runSnap.data()!;
    if (run.carrier !== CARRIER_ID) {
      throw new HttpsError("failed-precondition", "Run is not a State Farm sweep");
    }
    if (run.createdBy && run.createdBy !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Only the user who started the sweep can post results",
      );
    }

    const policyRef = collections.policies.doc(data.policyId);
    const policySnap = await policyRef.get();
    if (!policySnap.exists) {
      throw new HttpsError("not-found", `Policy ${data.policyId} not found`);
    }
    const policy = policySnap.data()!;
    if (policy.organizationId !== run.organizationId) {
      throw new HttpsError(
        "permission-denied",
        "Policy does not belong to this run's org",
      );
    }

    // Org compliance rules (used by normalizer).
    const orgSnap = await collections.organizations.doc(run.organizationId).get();
    const rules = orgSnap.data()?.settings?.complianceRules;

    const success = !data.error && !!data.scraped;
    const batch = db.batch();

    if (success) {
      const { parsed, complianceIssues, dashboardStatus } =
        normalizeStateFarmScrape(data.scraped!, rules);

      const policyUpdate: Record<string, unknown> = {
        status: parsed.status,
        policyStatus: parsed.status,
        insuranceProvider: "State Farm",
        verificationSource: "manual-extension",
        lastVerifiedAt: FieldValue.serverTimestamp(),
        lastVerificationError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        complianceIssues,
        dashboardStatus,
        isLienholderListed: parsed.isLienholderListed,
      };
      if (parsed.policyNumber) policyUpdate.policyNumber = parsed.policyNumber;
      if (parsed.coveragePeriod) policyUpdate.coveragePeriod = parsed.coveragePeriod;
      if (parsed.coverages.length > 0) policyUpdate.coverages = parsed.coverages;
      if (parsed.interestedParties.length > 0)
        policyUpdate.interestedParties = parsed.interestedParties;

      batch.update(policyRef, policyUpdate);
      batch.update(runRef, { successCount: FieldValue.increment(1) });
    } else {
      // Record the failure without stamping lastVerifiedAt — a failed sweep
      // must not light up the "Verified" badge while the provisional
      // UNVERIFIED ("Pending Verification") issue is still present.
      batch.update(policyRef, {
        verificationSource: "manual-extension",
        lastVerificationAttempt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastVerificationError: data.error ?? "Unknown error",
      });
      batch.update(runRef, { errorCount: FieldValue.increment(1) });
    }

    const resultRef = runRef.collection("results").doc(data.policyId);
    batch.set(resultRef, {
      policyId: data.policyId,
      success,
      policyStatus: success
        ? normalizeStateFarmScrape(data.scraped!, rules).parsed.status
        : PolicyStatus.NOT_AVAILABLE,
      errorReason: data.error ?? null,
      durationMs: data.durationMs ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return { ok: true };
  },
);

/**
 * Called once by the dashboard/extension when the sweep loop completes
 * (success, cancellation, or fatal failure). Stamps the final status on
 * the run doc so the dashboard banner can flip from "running" to "done".
 */
export const finalizeStateFarmSweep = onCall(
  { region: "us-central1", timeoutSeconds: 20, memory: "256MiB" },
  async (request): Promise<{ ok: true }> => {
    const { user, uid } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as FinalizeSweepRequest | undefined;
    if (!data?.runId) {
      throw new HttpsError("invalid-argument", "runId is required");
    }

    const runRef = db.collection("dataFeedRuns").doc(data.runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) {
      throw new HttpsError("not-found", `Run ${data.runId} not found`);
    }
    const run = runSnap.data()!;
    if (run.createdBy && run.createdBy !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Only the user who started the sweep can finalize it",
      );
    }

    await runRef.update({
      status: data.status ?? "completed",
      completedAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[state-farm-sweep] Finalized runId=${data.runId} status=${data.status ?? "completed"}`);
    return { ok: true };
  },
);
