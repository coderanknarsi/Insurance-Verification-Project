import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg, isSuperAdmin } from "../middleware/auth";
import { UserRole } from "../types/user";
import { PolicyStatus, ComplianceIssue, DashboardStatus } from "../types/policy";
import {
  getPolicyVerificationState,
  normalizeCarrier,
  VerificationState,
} from "../services/verification-eligibility";
import {
  normalizeStateFarmScrape,
  toIsoDate,
  type StateFarmScrapedPolicy,
} from "../services/state-farm-normalize";
import {
  normalizeProgressiveScrape,
  type ProgressiveScrapedPolicy,
} from "../services/progressive-normalize";
import {
  normalizeAllstateScrape,
  type AllstateScrapedPolicy,
} from "../services/allstate-normalize";
import { classifySweepOutcome } from "../services/carrier-switch";
import { extractSnapshot } from "../services/policy-snapshot";
import { diffPolicySnapshot } from "../services/policy-diff";
import type { ComplianceRules } from "../types/organization";
import type { VerificationInput } from "./data-feed-types";
import { dispatchStatusWebhook } from "../services/outbound-webhook";
import { dispatchDealerSweepAlert } from "../services/dealer-sweep-alert";

/**
 * Manual operator-driven carrier sweep callables.
 *
 * These are the generalized successors to the State Farm-specific callables
 * in `state-farm-sweep.ts`. The Chrome extension still calls the old ones;
 * the new AutoLien Operator desktop app calls these.
 *
 * Spec: docs/superpowers/specs/2026-05-27-autolien-operator-design.md §4.3
 */

// UI/operator IDs → canonical internal IDs used by the dispatcher + normalizers.
const CARRIER_ID_MAP: Record<string, string> = {
  "state-farm": "state_farm",
  "state_farm": "state_farm",
  "progressive": "progressive",
  "allstate": "allstate",
};

function canonicalCarrierId(carrierId: string | undefined): string {
  if (!carrierId) {
    throw new HttpsError("invalid-argument", "carrierId is required");
  }
  const canonical = CARRIER_ID_MAP[carrierId];
  if (!canonical) {
    throw new HttpsError(
      "invalid-argument",
      `Unsupported carrierId: ${carrierId}`,
    );
  }
  return canonical;
}

/**
 * Dispatch a carrier-specific scrape to the matching normalizer. Each
 * normalizer returns the same `{ parsed, complianceIssues, dashboardStatus }`
 * contract so the recording logic is shared. Keyed by canonical carrier id so
 * a single (portfolio) run can mix carriers.
 */
function normalizeScrapeForCarrier(
  carrierId: string,
  scraped: StateFarmScrapedPolicy | ProgressiveScrapedPolicy | AllstateScrapedPolicy,
  rules: ComplianceRules | undefined,
) {
  switch (canonicalCarrierId(carrierId)) {
    case "progressive":
      return normalizeProgressiveScrape(scraped as ProgressiveScrapedPolicy, rules);
    case "state_farm":
      return normalizeStateFarmScrape(scraped as StateFarmScrapedPolicy, rules);
    case "allstate":
      return normalizeAllstateScrape(scraped as AllstateScrapedPolicy, rules);
    default:
      throw new HttpsError(
        "invalid-argument",
        `No normalizer for carrierId: ${carrierId}`,
      );
  }
}

interface StartManualSweepRequest {
  organizationId: string;
  carrierId: string;
  borrowerId?: string; // optional: scope the sweep to a single borrower
}

interface StartManualSweepResponse {
  runId: string;
  carrierId: string;
  policies: VerificationInput[];
}

interface RecordManualResultRequest {
  runId: string;
  policyId: string;
  // Per-carrier scrape shape; dispatched to the matching normalizer by carrierId.
  scraped?: StateFarmScrapedPolicy | ProgressiveScrapedPolicy | AllstateScrapedPolicy;
  error?: string;
  durationMs?: number;
  screenshotPaths?: string[];
  tracePath?: string;
  aiSteps?: Array<{ ts: number; action: string; reasoning: string }>;
}

interface FinalizeManualSweepRequest {
  runId: string;
  status?: "completed" | "cancelled" | "failed";
}

interface RequestHumanReviewRequest {
  runId: string;
  policyId: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  screenshotPath?: string;
}

interface ResolveHumanReviewRequest {
  runId: string;
  policyId: string;
  reviewId?: string;
  choice: string;
}

export const startManualCarrierSweep = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request): Promise<StartManualSweepResponse> => {
    const { user, uid } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as StartManualSweepRequest | undefined;
    if (!data?.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required");
    }
    const carrierId = canonicalCarrierId(data.carrierId);
    if (!isSuperAdmin(request)) {
      requireOrg(user, data.organizationId);
    }

    const orgId = data.organizationId;
    const scopeBorrowerId = data.borrowerId ?? null;

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
      if (scopeBorrowerId && p.borrowerId !== scopeBorrowerId) continue;
      if (normalizeCarrier(p.insuranceProvider) !== carrierId) continue;

      const state = getPolicyVerificationState(p, orgId, activeCarriers);
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
        insuranceProvider: p.insuranceProvider ?? data.carrierId,
      });
    }

    const runId = `op_${Date.now()}_${orgId}_${carrierId}`;
    await db.collection("dataFeedRuns").doc(runId).set({
      runId,
      status: "awaiting_operator",
      carrier: carrierId,
      carrierId, // new field, matches spec §4.4
      mode: "manual-operator", // new field, matches spec §4.4
      triggeredBy: "manual-operator",
      startedAt: FieldValue.serverTimestamp(),
      orgsProcessed: [orgId],
      organizationId: orgId,
      createdBy: uid,
      totalPolicies: inputs.length,
      successCount: 0,
      errorCount: 0,
      policyQueue: inputs.map((p) => ({
        policyId: p.policyId,
        vin: p.vin,
        borrowerLastName: p.borrowerLastName,
        borrowerFirstName: p.borrowerFirstName ?? null,
        policyNumber: p.policyNumber ?? null,
        insuranceProvider: p.insuranceProvider ?? null,
      })),
    });

    logger.info(
      `[manual-sweep] Start runId=${runId} org=${orgId} carrier=${carrierId} policies=${inputs.length} by=${uid}`,
    );

    return { runId, carrierId, policies: inputs };
  },
);

export const recordManualSweepResult = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request): Promise<{ ok: true }> => {
    const { user, uid } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as RecordManualResultRequest | undefined;
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
    if (run.mode && run.mode !== "manual-operator") {
      throw new HttpsError(
        "failed-precondition",
        "Run is not a manual-operator run",
      );
    }
    if (run.createdBy && run.createdBy !== uid && !isSuperAdmin(request)) {
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

    const orgSnap = await collections.organizations.doc(run.organizationId).get();
    const rules = orgSnap.data()?.settings?.complianceRules;

    const success = !data.error && !!data.scraped;
    const batch = db.batch();

    let parsedStatus: PolicyStatus = PolicyStatus.NOT_AVAILABLE;
    // Captured for the outbound partner webhook (fired after commit).
    let webhookDashboardStatus: string | null = null;
    let webhookComplianceIssues: string[] = [];
    let webhookLienholderListed: boolean | null = null;
    let webhookChangeTypes: string[] = [];
    let webhookChangeSummary: string | null = null;

    if (success) {
      // Dispatch to the carrier-specific normalizer by THIS policy's carrier
      // (a portfolio run mixes carriers, so the run-level carrierId can't be
      // trusted). Fall back to the run carrier for legacy single-carrier runs.
      const policyCarrier =
        normalizeCarrier(policy.insuranceProvider as string | undefined) ||
        (run.carrierId as string | undefined) ||
        "";
      const { parsed, complianceIssues, dashboardStatus } =
        normalizeScrapeForCarrier(
          policyCarrier,
          data.scraped! as StateFarmScrapedPolicy | ProgressiveScrapedPolicy,
          rules,
        );
      parsedStatus = parsed.status;

      // The carrier portal frequently omits an expiration date, but the
      // borrower's uploaded insurance card (parsed via OCR at intake) usually
      // carries both effective and expiration dates. Preserve the existing
      // end date so a portal sweep never erases a real expiration.
      const existingPeriod = policy.coveragePeriod as
        | { startDate?: string; endDate?: string }
        | undefined;
      const existingEndDate = toIsoDate(existingPeriod?.endDate);
      const mergedPeriod = parsed.coveragePeriod
        ? {
            ...parsed.coveragePeriod,
            ...(parsed.coveragePeriod.endDate
              ? {}
              : existingEndDate
                ? { endDate: existingEndDate }
                : {}),
          }
        : existingPeriod;

      let finalComplianceIssues = complianceIssues;
      let finalDashboardStatus = dashboardStatus;
      // If the preserved (card-sourced) expiration is in the past, surface it.
      if (
        mergedPeriod?.endDate &&
        new Date(mergedPeriod.endDate).getTime() < Date.now() &&
        !finalComplianceIssues.includes(ComplianceIssue.COVERAGE_EXPIRED)
      ) {
        finalComplianceIssues = [
          ...finalComplianceIssues,
          ComplianceIssue.COVERAGE_EXPIRED,
        ];
        finalDashboardStatus = DashboardStatus.RED;
      }

      const policyUpdate: Record<string, unknown> = {
        status: parsed.status,
        policyStatus: parsed.status,
        verificationSource: "manual-operator",
        lastVerifiedAt: FieldValue.serverTimestamp(),
        lastVerificationError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        complianceIssues: finalComplianceIssues,
        dashboardStatus: finalDashboardStatus,
        isLienholderListed: parsed.isLienholderListed,
      };
      if (parsed.policyNumber) policyUpdate.policyNumber = parsed.policyNumber;
      if (mergedPeriod) policyUpdate.coveragePeriod = mergedPeriod;
      if (parsed.coverages.length > 0) policyUpdate.coverages = parsed.coverages;
      if (parsed.interestedParties.length > 0)
        policyUpdate.interestedParties = parsed.interestedParties;

      // Carrier-switch vs lapse: if the carrier on file returns NO record but
      // the borrower previously had active coverage here, treat it as a likely
      // insurer switch (soft YELLOW + flag) instead of a hard lapse that would
      // trigger the repo-track lapse cadence. The change trigger then routes a
      // "confirm coverage" proof request to the borrower.
      const hadPriorCoverage =
        policy.lastSnapshot?.status === PolicyStatus.ACTIVE ||
        policy.status === PolicyStatus.ACTIVE;
      const outcome = classifySweepOutcome({
        parsedStatus: parsed.status,
        recordFound: parsed.status !== PolicyStatus.NOT_AVAILABLE,
        hadPriorCoverage,
      });
      if (outcome === "POSSIBLE_SWITCH") {
        policyUpdate.possibleCarrierSwitch = true;
        policyUpdate.carrierSwitchDetectedAt = FieldValue.serverTimestamp();
        // Keep status soft — do not force CANCELLED.
        delete policyUpdate.status;
        delete policyUpdate.policyStatus;
        finalDashboardStatus = DashboardStatus.YELLOW;
        policyUpdate.dashboardStatus = finalDashboardStatus;
      } else {
        policyUpdate.possibleCarrierSwitch = FieldValue.delete();
        policyUpdate.carrierSwitchDetectedAt = FieldValue.delete();
      }

      webhookDashboardStatus = finalDashboardStatus;
      webhookComplianceIssues = finalComplianceIssues;
      webhookLienholderListed = parsed.isLienholderListed;

      // Summarize what changed for the partner webhook. Compares the prior
      // snapshot to an approximation of the post-sweep policy. Best-effort only.
      try {
        const beforeSnap = policy.lastSnapshot ?? extractSnapshot(policy as never);
        const afterSnap = extractSnapshot({
          ...policy,
          status: outcome === "POSSIBLE_SWITCH" ? policy.status : parsed.status,
          policyNumber: parsed.policyNumber ?? policy.policyNumber,
          coverages: parsed.coverages.length > 0 ? parsed.coverages : policy.coverages,
          coveragePeriod: mergedPeriod ?? policy.coveragePeriod,
          isLienholderListed: parsed.isLienholderListed,
          dashboardStatus: finalDashboardStatus,
        } as never);
        const changes = diffPolicySnapshot(beforeSnap, afterSnap);
        webhookChangeTypes = changes.map((c) => c.type);
        webhookChangeSummary =
          changes.length > 0 ? changes.map((c) => c.summary).join("; ") : null;
      } catch {
        // Non-fatal: webhook still fires without change metadata.
      }

      batch.update(policyRef, policyUpdate);
      batch.update(runRef, { successCount: FieldValue.increment(1) });
    } else {
      // A failed sweep must NOT stamp lastVerifiedAt — doing so would light up
      // the "Verified" badge (state INSURED_SUPPORTED + lastVerifiedAt) while
      // the provisional UNVERIFIED ("Pending Verification") issue is still
      // present, producing a contradictory "Verified + Pending Verification"
      // state. Record the attempt + error only; leave verification status as-is.
      batch.update(policyRef, {
        verificationSource: "manual-operator",
        lastVerificationAttempt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastVerificationError: data.error ?? "Unknown error",
      });
      batch.update(runRef, { errorCount: FieldValue.increment(1) });
    }

    const resultRef = runRef.collection("results").doc(data.policyId);
    const resultDoc: Record<string, unknown> = {
      policyId: data.policyId,
      success,
      policyStatus: success ? parsedStatus : PolicyStatus.NOT_AVAILABLE,
      errorReason: data.error ?? null,
      durationMs: data.durationMs ?? null,
      createdAt: FieldValue.serverTimestamp(),
    };
    if (data.screenshotPaths && data.screenshotPaths.length > 0) {
      resultDoc.screenshotPaths = data.screenshotPaths;
    }
    if (data.tracePath) resultDoc.tracePath = data.tracePath;
    if (data.aiSteps && data.aiSteps.length > 0) resultDoc.aiSteps = data.aiSteps;
    batch.set(resultRef, resultDoc);

    await batch.commit();

    // Notify the org's partner integration (DMS/CRM), if configured. Strictly
    // fire-and-forget: webhook delivery must never affect result recording.
    const policyIdForHook = data.policyId;
    void (async () => {
      let loanNumber: string | null = null;
      if (policy.borrowerId) {
        const borrowerSnap = await collections.borrowers
          .doc(policy.borrowerId as string)
          .get()
          .catch(() => null);
        loanNumber = (borrowerSnap?.data()?.loanNumber as string | undefined) ?? null;
      }
      await dispatchStatusWebhook(run.organizationId as string, {
        policyId: policyIdForHook,
        loanNumber,
        status: success ? parsedStatus : ((policy.status as string) ?? null),
        dashboardStatus: webhookDashboardStatus,
        complianceIssues: webhookComplianceIssues,
        isLienholderListed: webhookLienholderListed,
        lastVerifiedAt: success ? new Date().toISOString() : null,
        lastVerificationError: success ? null : (data.error ?? "Unknown error"),
        verifiedVia: "manual-operator",
        changeTypes: webhookChangeTypes,
        changeSummary: webhookChangeSummary,
      });
    })();

    return { ok: true };
  },
);

export const finalizeManualSweep = onCall(
  { region: "us-central1", timeoutSeconds: 20, memory: "256MiB" },
  async (request): Promise<{ ok: true }> => {
    const { user, uid } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as FinalizeManualSweepRequest | undefined;
    if (!data?.runId) {
      throw new HttpsError("invalid-argument", "runId is required");
    }

    const runRef = db.collection("dataFeedRuns").doc(data.runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) {
      throw new HttpsError("not-found", `Run ${data.runId} not found`);
    }
    const run = runSnap.data()!;
    if (run.createdBy && run.createdBy !== uid && !isSuperAdmin(request)) {
      throw new HttpsError(
        "permission-denied",
        "Only the user who started the sweep can finalize it",
      );
    }

    await runRef.update({
      status: data.status ?? "completed",
      completedAt: FieldValue.serverTimestamp(),
    });

    logger.info(
      `[manual-sweep] Finalize runId=${data.runId} status=${data.status ?? "completed"}`,
    );

    // Recap email to the dealer's admins so a failed/partial sweep can't pass
    // silently. Best-effort, fire-and-forget, and sent at most once per run.
    if (!run.dealerAlertSentAt) {
      const verified = (run.successCount as number) ?? 0;
      const failed = (run.errorCount as number) ?? 0;
      const total = (run.totalPolicies as number) ?? verified + failed;
      void dispatchDealerSweepAlert(run.organizationId as string, data.runId, {
        total,
        verified,
        failed,
        issuesFound: 0,
      });
    }

    return { ok: true };
  },
);

export const requestHumanReview = onCall(
  { region: "us-central1", timeoutSeconds: 20, memory: "256MiB" },
  async (request): Promise<{ reviewId: string }> => {
    const { user, uid } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as RequestHumanReviewRequest | undefined;
    if (!data?.runId || !data.policyId || !data.prompt || !data.options) {
      throw new HttpsError(
        "invalid-argument",
        "runId, policyId, prompt, and options are required",
      );
    }
    if (data.options.length === 0) {
      throw new HttpsError("invalid-argument", "options must be non-empty");
    }

    const runRef = db.collection("dataFeedRuns").doc(data.runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) {
      throw new HttpsError("not-found", `Run ${data.runId} not found`);
    }
    const run = runSnap.data()!;
    if (run.createdBy && run.createdBy !== uid && !isSuperAdmin(request)) {
      throw new HttpsError("permission-denied", "Run does not belong to you");
    }

    const reviewRef = runRef.collection("humanReviews").doc();
    await reviewRef.set({
      reviewId: reviewRef.id,
      runId: data.runId,
      policyId: data.policyId,
      prompt: data.prompt,
      options: data.options,
      screenshotPath: data.screenshotPath ?? null,
      status: "pending",
      choice: null,
      requestedAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
    });

    logger.info(
      `[manual-sweep] requestHumanReview run=${data.runId} policy=${data.policyId} review=${reviewRef.id}`,
    );

    return { reviewId: reviewRef.id };
  },
);

export const resolveHumanReview = onCall(
  { region: "us-central1", timeoutSeconds: 20, memory: "256MiB" },
  async (request): Promise<{ ok: true }> => {
    const { user, uid } = await requireAuth(request);
    if (!isSuperAdmin(request)) {
      requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    }

    const data = request.data as ResolveHumanReviewRequest | undefined;
    if (!data?.runId || !data.policyId || !data.choice) {
      throw new HttpsError(
        "invalid-argument",
        "runId, policyId, and choice are required",
      );
    }

    const runRef = db.collection("dataFeedRuns").doc(data.runId);
    const reviewsCol = runRef.collection("humanReviews");

    let reviewRef = data.reviewId ? reviewsCol.doc(data.reviewId) : null;
    if (!reviewRef) {
      // Pick the most recent pending review for that policy.
      const pending = await reviewsCol
        .where("policyId", "==", data.policyId)
        .where("status", "==", "pending")
        .orderBy("requestedAt", "desc")
        .limit(1)
        .get();
      if (pending.empty) {
        throw new HttpsError(
          "not-found",
          `No pending review found for policy ${data.policyId}`,
        );
      }
      reviewRef = pending.docs[0].ref;
    }

    const reviewSnap = await reviewRef.get();
    if (!reviewSnap.exists) {
      throw new HttpsError("not-found", "Human review not found");
    }
    const review = reviewSnap.data()!;
    if (review.status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        `Review is already ${review.status}`,
      );
    }
    const optionIds = (review.options as Array<{ id: string }>).map(
      (o) => o.id,
    );
    if (!optionIds.includes(data.choice)) {
      throw new HttpsError(
        "invalid-argument",
        `choice "${data.choice}" is not one of the offered options`,
      );
    }

    await reviewRef.update({
      status: "resolved",
      choice: data.choice,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: uid,
    });

    logger.info(
      `[manual-sweep] resolveHumanReview run=${data.runId} policy=${data.policyId} choice=${data.choice}`,
    );
    return { ok: true };
  },
);
