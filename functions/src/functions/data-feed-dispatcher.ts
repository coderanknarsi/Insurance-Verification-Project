import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { GoogleAuth } from "google-auth-library";
import { db } from "../config/firebase";
import { DEMO_ORG_ID } from "../constants";
import {
  getOrgVerificationDay,
  getPolicyVerificationState,
  hasOperatorAdapter,
  normalizeCarrier,
  VerificationState,
} from "../services/verification-eligibility";
import {
  summarizeEngineBatchResult,
  type EngineBatchResultSummary,
} from "../services/engine-batch-result";
import { getLenderAlertEmail } from "../services/lender-email";
import { sendSweepReminderEmail } from "../services/email";
import type { VerificationBatch, VerificationInput } from "./data-feed-types";

const DASHBOARD_URL = "https://app.autolientracker.com";

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
 * Per-Org Weekly Sweep-Day Reminder.
 *
 * Runs Mon–Fri at 7 AM CT. Each org has a stable assigned weekday (1=Mon … 5=Fri)
 * derived from a hash of its id, with optional admin override via
 * `org.settings.verificationDayOfWeek`. Only orgs whose assigned day equals
 * today are notified.
 *
 * Carrier portals require a human to be logged in, so we cannot run a headless
 * sweep. Instead, on each org's sweep day we:
 *   1. Classify policies into portal-automatable vs. manual-verification.
 *   2. Write a `sweepReminders/{orgId}` doc the dashboard surfaces as a banner.
 *   3. Email the dealer admin to open the operator and click "Sweep Portfolio".
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
    const todayWeekday = currentChicagoWeekday();
    if (!todayWeekday) {
      logger.info("[sweep-reminder] Not a weekday in Chicago — skipping");
      return;
    }

    const runStart = Date.now();
    logger.info(`[sweep-reminder] Starting reminder run (weekday=${todayWeekday})`);

    const orgsSnap = await db.collection("organizations").get();
    let orgsNotified = 0;
    let emailsSent = 0;

    for (const orgDoc of orgsSnap.docs) {
      if (orgDoc.id === DEMO_ORG_ID) continue;

      const orgData = orgDoc.data();
      const assignedDay = getOrgVerificationDay(
        orgDoc.id,
        orgData.settings?.verificationDayOfWeek,
      );
      if (assignedDay !== todayWeekday) continue;

      try {
        const sent = await sendSweepReminderForOrg(
          orgDoc.id,
          orgData.name ?? "your dealership",
        );
        orgsNotified++;
        if (sent) emailsSent++;
      } catch (err) {
        logger.error(`[sweep-reminder] Org ${orgDoc.id} failed`, err);
      }
    }

    logger.info(
      `[sweep-reminder] Run complete — orgs=${orgsNotified}, ` +
        `emails=${emailsSent}, duration=${Date.now() - runStart}ms`,
    );
  },
);

/**
 * Classifies an org's book, writes the sweep-reminder banner doc, and emails
 * the dealer admin. Returns whether the reminder email was sent.
 */
export async function sendSweepReminderForOrg(
  orgId: string,
  dealershipName: string,
): Promise<boolean> {
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

  const policiesSnap = await db
    .collection("policies")
    .where("organizationId", "==", orgId)
    .get();

  let operatorReadyCount = 0;
  let manualCount = 0;
  const carriers = new Set<string>();

  for (const policyDoc of policiesSnap.docs) {
    const p = policyDoc.data();
    const carrier = normalizeCarrier(p.insuranceProvider);
    if (!carrier) continue;

    if (!hasOperatorAdapter(carrier)) {
      manualCount++;
      continue;
    }

    const state = getPolicyVerificationState(p as never, orgId, activeCarriers);
    if (
      state === VerificationState.INSURED_SUPPORTED ||
      state === VerificationState.INSURED_NO_CREDS
    ) {
      operatorReadyCount++;
      carriers.add(carrier);
    }
  }

  await db
    .collection("sweepReminders")
    .doc(orgId)
    .set({
      organizationId: orgId,
      dueOn: new Date(),
      operatorReadyCount,
      manualCount,
      carriers: Array.from(carriers).sort(),
      acknowledged: false,
      createdAt: new Date(),
    });

  logger.info(
    `[sweep-reminder] Org ${orgId} — ready=${operatorReadyCount}, ` +
      `manual=${manualCount}, carriers=${Array.from(carriers).join(",")}`,
  );

  const to = await getLenderAlertEmail(orgId);
  if (!to) {
    logger.warn(`[sweep-reminder] No admin email for org ${orgId} — banner only`);
    return false;
  }

  const result = await sendSweepReminderEmail({
    to,
    dealershipName,
    operatorReadyCount,
    manualCount,
    dashboardUrl: DASHBOARD_URL,
  });
  if (!result.success) {
    logger.warn(`[sweep-reminder] Email failed for org ${orgId}: ${result.error}`);
  }
  return result.success;
}

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

  // Active master credentials (platform-wide) → set of carrier ids
  const credsSnap = await db
    .collection("masterCredentials")
    .where("active", "==", true)
    .get();
  const activeCarriers = new Set(
    credsSnap.docs.flatMap((doc) => {
      const d = doc.data() as {
        carrierId?: string;
        carrierName?: string;
      };
      return [doc.id, d.carrierId, d.carrierName]
        .map((v) => normalizeCarrier(v))
        .filter(Boolean);
    }),
  );

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
      const batchSummary = await sendBatchToEngine(batch);
      result.successCount += batchSummary.successCount;
      result.errorCount += batchSummary.errorCount;
      logger.info(
        `[data-feed] Dispatched batch ${batchId} — ` +
          `${batchSummary.successCount} verified, ${batchSummary.errorCount} errors ` +
          `(${batchSummary.resultCount}/${inputs.length} results)`,
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
async function sendBatchToEngine(batch: VerificationBatch): Promise<EngineBatchResultSummary> {
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

  return summarizeEngineBatchResult(response.data, batch.policies.length);
}
