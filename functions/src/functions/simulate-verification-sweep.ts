import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireSuperAdmin } from "../middleware/auth";
import { runSweepForOrg } from "./data-feed-dispatcher";
import { db } from "../config/firebase";

interface SimulateRequest {
  orgId: string;
  /** When true, also persist a dataFeedRuns record. Defaults to false. */
  persistRun?: boolean;
}

interface SimulateResponse {
  runId: string;
  orgId: string;
  batches: number;
  policies: number;
  successCount: number;
  errorCount: number;
  buckets: {
    pendingUpload: number;
    insuredSupported: number;
    insuredUnsupported: number;
    insuredNoCreds: number;
  };
  durationMs: number;
}

/**
 * Admin-only callable to run a verification sweep for one org on demand.
 * Bypasses today-is-your-day filter — used for QA / debugging / customer support.
 */
export const simulateVerificationSweep = onCall(
  { region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (request): Promise<SimulateResponse> => {
    requireSuperAdmin(request);
    const data = request.data as SimulateRequest | undefined;
    if (!data?.orgId) {
      throw new HttpsError("invalid-argument", "orgId is required");
    }

    const runId = `simrun_${Date.now()}`;
    const start = Date.now();
    logger.info(`[simulate-sweep] Starting ${runId} for org=${data.orgId}`);

    const result = await runSweepForOrg(data.orgId, runId);
    const durationMs = Date.now() - start;

    if (data.persistRun) {
      await db.collection("dataFeedRuns").doc(runId).set({
        runId,
        status: "completed",
        startedAt: new Date(start),
        completedAt: new Date(),
        triggeredBy: "simulate",
        orgsProcessed: [data.orgId],
        bucketsByOrg: { [data.orgId]: result.buckets },
        totalBatches: result.batches,
        totalPolicies: result.policies,
        successCount: result.successCount,
        errorCount: result.errorCount,
        durationMs,
      });
    }

    logger.info(`[simulate-sweep] Done ${runId}`, { ...result, durationMs });

    return {
      runId,
      orgId: result.orgId,
      batches: result.batches,
      policies: result.policies,
      successCount: result.successCount,
      errorCount: result.errorCount,
      buckets: result.buckets,
      durationMs,
    };
  },
);
