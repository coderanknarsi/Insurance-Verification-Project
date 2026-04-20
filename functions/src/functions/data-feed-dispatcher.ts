import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { GoogleAuth } from "google-auth-library";
import { db } from "../config/firebase";
import { DEMO_ORG_ID } from "../constants";
import type { VerificationBatch, VerificationInput } from "./data-feed-types";

const ENGINE_URL = process.env.DATA_FEED_ENGINE_URL ?? "";

/**
 * Weekly Data Feed Dispatcher — runs every Sunday at 2 AM CT.
 *
 * For each organization:
 * 1. Queries all policies grouped by insurance provider
 * 2. Looks up VIN + borrower info for each policy
 * 3. Sends one batch per carrier to the Cloud Run engine worker
 * 4. Records the run in Firestore for auditing
 */
export const weeklyDataFeedDispatcher = onSchedule(
  {
    schedule: "0 2 * * 0", // 2:00 AM every Sunday
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

    const runId = `run_${Date.now()}`;
    const runStart = Date.now();

    logger.info(`[data-feed] Starting weekly run ${runId}`);

    // Record the run
    const runRef = db.collection("dataFeedRuns").doc(runId);
    await runRef.set({
      runId,
      status: "running",
      startedAt: new Date(),
      triggeredBy: "scheduler",
    });

    // Get all organizations (skip demo)
    const orgsSnap = await db.collection("organizations").get();
    let totalBatches = 0;
    let totalPolicies = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const orgDoc of orgsSnap.docs) {
      if (orgDoc.id === DEMO_ORG_ID) continue;

      const orgId = orgDoc.id;

      // Check if org has any carrier credentials configured
      const credsSnap = await db
        .collection("organizations")
        .doc(orgId)
        .collection("carrierCredentials")
        .where("active", "==", true)
        .get();

      if (credsSnap.empty) continue;

      const activeCarriers = new Set(credsSnap.docs.map((d) => d.id));

      // Get all policies for this org
      const policiesSnap = await db
        .collection("policies")
        .where("organizationId", "==", orgId)
        .get();

      if (policiesSnap.empty) continue;

      // Group policies by carrier (insuranceProvider)
      const carrierBuckets = new Map<string, Array<{ policyId: string; vehicleId: string; borrowerId: string; policyNumber?: string; insuranceProvider: string }>>();

      for (const policyDoc of policiesSnap.docs) {
        const p = policyDoc.data();
        const carrier = normalizeCarrierName(p.insuranceProvider ?? "");
        if (!carrier || !activeCarriers.has(carrier)) continue;

        if (!carrierBuckets.has(carrier)) carrierBuckets.set(carrier, []);
        carrierBuckets.get(carrier)!.push({
          policyId: policyDoc.id,
          vehicleId: p.vehicleId,
          borrowerId: p.borrowerId,
          policyNumber: p.policyNumber,
          insuranceProvider: p.insuranceProvider ?? carrier,
        });
      }

      // For each carrier bucket, enrich with VIN + borrower name, send batch
      for (const [carrier, policies] of carrierBuckets) {
        const inputs: VerificationInput[] = [];

        for (const p of policies) {
          // Look up vehicle VIN
          const vehicleDoc = await db.collection("vehicles").doc(p.vehicleId).get();
          const vin = vehicleDoc.data()?.vin;
          if (!vin) {
            logger.warn(`[data-feed] Skipping policy ${p.policyId} — no VIN on vehicle ${p.vehicleId}`);
            continue;
          }

          // Look up borrower name
          const borrowerDoc = await db.collection("borrowers").doc(p.borrowerId).get();
          const borrower = borrowerDoc.data();
          if (!borrower?.lastName) {
            logger.warn(`[data-feed] Skipping policy ${p.policyId} — no last name on borrower ${p.borrowerId}`);
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

        totalBatches++;
        totalPolicies += inputs.length;

        try {
          await sendBatchToEngine(batch);
          successCount += inputs.length;
          logger.info(`[data-feed] Dispatched batch ${batchId} — ${inputs.length} policies`);
        } catch (err) {
          errorCount += inputs.length;
          logger.error(`[data-feed] Batch ${batchId} failed:`, err);
        }
      }
    }

    // Update run status
    await runRef.update({
      status: "completed",
      completedAt: new Date(),
      totalBatches,
      totalPolicies,
      successCount,
      errorCount,
      durationMs: Date.now() - runStart,
    });

    logger.info(
      `[data-feed] Run ${runId} complete — ` +
        `batches=${totalBatches}, policies=${totalPolicies}, ` +
        `success=${successCount}, errors=${errorCount}, ` +
        `duration=${Date.now() - runStart}ms`
    );
  }
);

/**
 * Sends a verification batch to the Cloud Run engine worker.
 * Uses authenticated fetch with Identity Token for Cloud Run.
 */
async function sendBatchToEngine(batch: VerificationBatch): Promise<void> {
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(ENGINE_URL);
  const response = await client.request({
    url: `${ENGINE_URL}/verify`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  });

  if (response.status !== 200) {
    throw new Error(`Engine returned ${response.status}: ${JSON.stringify(response.data)}`);
  }
}

/**
 * Normalize carrier name to match registry IDs (lowercase, no spaces)
 */
function normalizeCarrierName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, "_");
}
