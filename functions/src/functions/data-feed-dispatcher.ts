import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { GoogleAuth } from "google-auth-library";
import { db } from "../config/firebase";
import { DEMO_ORG_ID } from "../constants";
import {
  getOrgVerificationDay,
  getPolicyVerificationState,
  normalizeCarrier,
  VerificationState,
} from "../services/verification-eligibility";
import type { VerificationBatch, VerificationInput } from "./data-feed-types";

const ENGINE_URL = process.env.DATA_FEED_ENGINE_URL ?? "";

export interface OrgSweepBuckets {
  pendingUpload: number;
  insuredSupported: number;
  insuredUnsupported: number;
  insuredNoCreds: number;
}

export interface OrgSweepResult {
  orgId: string;
  batches: number;
  policies: number;
  successCount: number;
  errorCount: number;
  buckets: OrgSweepBuckets;
}

/**
 * Per-Org Weekly Carrier Verification Dispatcher.
 *
 * Runs Mon–Fri at 7 AM CT. Each org has a stable assigned weekday (1=Mon … 5=Fri)
 * derived from a hash of its id, with optional admin override via
 * `org.settings.verificationDayOfWeek`. The dispatcher only processes orgs whose
 * assigned day equals today.
 *
 * For each in-scope org:
 *   1. Pull active master credentials → set of supported carriers.
 *   2. Walk policies, classify via `getPolicyVerificationState`.
 *   3. Bucket eligible (INSURED_SUPPORTED) policies by carrier.
 *   4. POST one batch per carrier to the Cloud Run engine `/verify`.
 *   5. Record bucket counts on the run document for dashboard surfacing.
 */
export const weeklyDataFeedDispatcher = onSchedule(
  {
    schedule: "0 7 * * 1-5", // 7:00 AM Mon–Fri (America/Chicago)
    timeZone: "America/Chicago",
    retryCount: 1,
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    if (!ENGINE_URL) {
      logger.error("DATA_FEED_ENGINE_URL not configured — skipping data feed run");
      return;
    }

    const todayWeekday = currentChicagoWeekday();
    if (!todayWeekday) {
      logger.info("[data-feed] Not a weekday in Chicago — skipping");
      return;
    }

    const runId = `run_${Date.now()}`;
    const runStart = Date.now();

    logger.info(`[data-feed] Starting run ${runId} (weekday=${todayWeekday})`);

    const runRef = db.collection("dataFeedRuns").doc(runId);
    await runRef.set({
      runId,
      status: "running",
      startedAt: new Date(),
      triggeredBy: "scheduler",
      weekday: todayWeekday,
    });

    const orgsSnap = await db.collection("organizations").get();
    let totalBatches = 0;
    let totalPolicies = 0;
    let successCount = 0;
    let errorCount = 0;
    const orgsProcessed: string[] = [];
    const bucketsByOrg: Record<string, OrgSweepBuckets> = {};

    for (const orgDoc of orgsSnap.docs) {
      if (orgDoc.id === DEMO_ORG_ID) continue;

      const orgData = orgDoc.data();
      const assignedDay = getOrgVerificationDay(
        orgDoc.id,
        orgData.settings?.verificationDayOfWeek,
      );
      if (assignedDay !== todayWeekday) continue;

      try {
        const result = await runSweepForOrg(orgDoc.id, runId);
        totalBatches += result.batches;
        totalPolicies += result.policies;
        successCount += result.successCount;
        errorCount += result.errorCount;
        orgsProcessed.push(orgDoc.id);
        bucketsByOrg[orgDoc.id] = result.buckets;
      } catch (err) {
        logger.error(`[data-feed] Org ${orgDoc.id} failed`, err);
      }
    }

    await runRef.update({
      status: "completed",
      completedAt: new Date(),
      totalBatches,
      totalPolicies,
      successCount,
      errorCount,
      durationMs: Date.now() - runStart,
      orgsProcessed,
      bucketsByOrg,
    });

    logger.info(
      `[data-feed] Run ${runId} complete — orgs=${orgsProcessed.length}, ` +
        `batches=${totalBatches}, policies=${totalPolicies}, ` +
        `success=${successCount}, errors=${errorCount}, ` +
        `duration=${Date.now() - runStart}ms`,
    );
  },
);

/**
 * Run a single org's sweep — used by the scheduled dispatcher and by the
 * admin `simulateVerificationSweep` callable. Idempotent; safe to call
 * multiple times for the same `runId`.
 */
export async function runSweepForOrg(
  orgId: string,
  runId: string,
): Promise<OrgSweepResult> {
  const buckets: OrgSweepBuckets = {
    pendingUpload: 0,
    insuredSupported: 0,
    insuredUnsupported: 0,
    insuredNoCreds: 0,
  };
  const result: OrgSweepResult = {
    orgId,
    batches: 0,
    policies: 0,
    successCount: 0,
    errorCount: 0,
    buckets,
  };

  // Active master credentials for this org → set of carrier ids
  const credsSnap = await db
    .collection("organizations")
    .doc(orgId)
    .collection("carrierCredentials")
    .where("active", "==", true)
    .get();
  const activeCarriers = new Set(credsSnap.docs.map((d) => d.id));

  const policiesSnap = await db
    .collection("policies")
    .where("organizationId", "==", orgId)
    .get();
  if (policiesSnap.empty) return result;

  const carrierBuckets = new Map<
    string,
    Array<{
      policyId: string;
      vehicleId: string;
      borrowerId: string;
      policyNumber?: string;
      insuranceProvider: string;
    }>
  >();

  for (const policyDoc of policiesSnap.docs) {
    const p = policyDoc.data();
    const state = getPolicyVerificationState(p as never, orgId, activeCarriers);

    switch (state) {
      case VerificationState.PENDING_UPLOAD:
        buckets.pendingUpload++;
        continue;
      case VerificationState.INSURED_UNSUPPORTED:
        buckets.insuredUnsupported++;
        continue;
      case VerificationState.INSURED_NO_CREDS:
        buckets.insuredNoCreds++;
        continue;
      case VerificationState.INSURED_SUPPORTED:
        buckets.insuredSupported++;
        break;
    }

    const carrier = normalizeCarrier(p.insuranceProvider);
    if (!carrierBuckets.has(carrier)) carrierBuckets.set(carrier, []);
    carrierBuckets.get(carrier)!.push({
      policyId: policyDoc.id,
      vehicleId: p.vehicleId,
      borrowerId: p.borrowerId,
      policyNumber: p.policyNumber,
      insuranceProvider: p.insuranceProvider ?? carrier,
    });
  }

  logger.info(`[data-feed] Org ${orgId} buckets`, buckets);

  for (const [carrier, policies] of carrierBuckets) {
    const inputs: VerificationInput[] = [];

    for (const p of policies) {
      const vehicleDoc = await db.collection("vehicles").doc(p.vehicleId).get();
      const vin = vehicleDoc.data()?.vin;
      if (!vin) {
        logger.warn(
          `[data-feed] Skipping policy ${p.policyId} — no VIN on vehicle ${p.vehicleId}`,
        );
        continue;
      }

      const borrowerDoc = await db.collection("borrowers").doc(p.borrowerId).get();
      const borrower = borrowerDoc.data();
      if (!borrower?.lastName) {
        logger.warn(
          `[data-feed] Skipping policy ${p.policyId} — no last name on borrower ${p.borrowerId}`,
        );
        continue;
      }

      inputs.push({
        policyId: p.policyId,
        organizationId: orgId,
        borrowerId: p.borrowerId,
        vehicleId: p.vehicleId,
        vin,
        borrowerLastName: borrower.lastName,
        borrowerFirstName: borrower.firstName,
        policyNumber: p.policyNumber,
        insuranceProvider: p.insuranceProvider,
      });
    }

    if (inputs.length === 0) continue;

    const batchId = `${runId}_${orgId}_${carrier}`;
    const batch: VerificationBatch = {
      batchId,
      runId,
      carrier,
      policies: inputs,
    };

    result.batches++;
    result.policies += inputs.length;

    try {
      await sendBatchToEngine(batch);
      result.successCount += inputs.length;
      logger.info(
        `[data-feed] Dispatched batch ${batchId} — ${inputs.length} policies`,
      );
    } catch (err) {
      result.errorCount += inputs.length;
      logger.error(`[data-feed] Batch ${batchId} failed:`, err);
    }
  }

  return result;
}

/**
 * Returns 1..5 for Mon..Fri in America/Chicago, or null on Sat/Sun.
 */
function currentChicagoWeekday(): 1 | 2 | 3 | 4 | 5 | null {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  });
  const map: Record<string, 1 | 2 | 3 | 4 | 5> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
  };
  return map[fmt.format(new Date())] ?? null;
}

/**
 * Sends a verification batch to the Cloud Run engine worker.
 * Uses authenticated fetch with Identity Token for Cloud Run.
 */
async function sendBatchToEngine(batch: VerificationBatch): Promise<void> {
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(ENGINE_URL);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sharedSecret = process.env.ENGINE_SHARED_SECRET ?? "";
  if (sharedSecret) {
    headers["x-engine-secret"] = sharedSecret;
  }
  const response = await client.request({
    url: `${ENGINE_URL}/verify`,
    method: "POST",
    headers,
    body: JSON.stringify(batch),
  });

  if (response.status !== 200) {
    throw new Error(
      `Engine returned ${response.status}: ${JSON.stringify(response.data)}`,
    );
  }
}
