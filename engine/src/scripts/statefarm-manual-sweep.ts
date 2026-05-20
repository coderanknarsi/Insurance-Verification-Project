/**
 * State Farm manual-assisted sweep.
 *
 * You run this on your own machine. It opens a real Chromium window via
 * Playwright using a persistent profile, you log into State Farm yourself
 * (including MFA) and navigate to the Insurance Inquiry Tool. Once you're
 * on the Policy Search page you press ENTER in this terminal, and the
 * script takes over: for each State Farm policy in the target org it fills
 * the VIN, runs the search, extracts the results via the existing carrier
 * module and writes back to Firestore exactly the same way the cloud
 * engine does.
 *
 * Auth: uses Application Default Credentials. Run once before first use:
 *   gcloud auth application-default login
 *
 * Required env (loaded from engine/.env):
 *   - GCP_PROJECT_ID
 *   - GOOGLE_AI_API_KEY     (Gemini Flash for auto-selection + extraction)
 *
 * Usage:
 *   npm run statefarm:sweep -- --org <orgId>
 *   npm run statefarm:sweep -- --org <orgId> --vin <singleVin>
 *   npm run statefarm:sweep -- --org <orgId> --headed=false   (debug only)
 */
import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import { createInterface } from "readline/promises";
import { Firestore } from "@google-cloud/firestore";
import { chromium, type BrowserContext, type Page } from "playwright";

import { StateFarmModule } from "../carriers/state-farm/module.js";
import { agentLoop } from "../agent/loop.js";
import { writeResult } from "../results/writer.js";
import { PolicyStatus } from "../types/policy.js";
import type {
  VerificationInput,
  VerificationResult,
} from "../types/verification.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotenv({ path: resolve(__dirname, "../../.env") });

const POLICY_SEARCH_URL =
  "https://b2b.statefarm.com/b2b-content/home-auto-lenders/ins-inquiry";
const POLICY_SEARCH_URL_FRAGMENT = "InsuranceInquiry/policySearch";
const PROFILE_DIR = resolve(__dirname, "../../.statefarm-profile");

interface Args {
  orgId: string;
  singleVin?: string;
  headed: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { orgId: "", headed: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--org") args.orgId = argv[++i];
    else if (a.startsWith("--org=")) args.orgId = a.slice("--org=".length);
    else if (a === "--vin") args.singleVin = argv[++i];
    else if (a.startsWith("--vin=")) args.singleVin = a.slice("--vin=".length);
    else if (a === "--headed=false") args.headed = false;
    else if (a === "--headless") args.headed = false;
  }
  if (!args.orgId) {
    throw new Error("Missing required --org <orgId>");
  }
  return args;
}

function isStateFarmProvider(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return raw.replace(/[^a-z]/gi, "").toLowerCase().includes("statefarm");
}

async function loadPoliciesForOrg(
  db: Firestore,
  orgId: string,
  singleVin?: string,
): Promise<VerificationInput[]> {
  const policiesSnap = await db
    .collection("policies")
    .where("organizationId", "==", orgId)
    .get();

  const inputs: VerificationInput[] = [];

  for (const policyDoc of policiesSnap.docs) {
    const p = policyDoc.data();
    if (!isStateFarmProvider(p.insuranceProvider)) continue;
    if (!p.vehicleId || !p.borrowerId) continue;

    const [vehicleDoc, borrowerDoc] = await Promise.all([
      db.collection("vehicles").doc(p.vehicleId).get(),
      db.collection("borrowers").doc(p.borrowerId).get(),
    ]);

    const vin = vehicleDoc.data()?.vin;
    const borrower = borrowerDoc.data();
    if (!vin) {
      console.warn(
        `[manual-sweep] Skipping policy ${policyDoc.id}: no VIN on vehicle ${p.vehicleId}`,
      );
      continue;
    }
    if (!borrower?.lastName) {
      console.warn(
        `[manual-sweep] Skipping policy ${policyDoc.id}: no last name on borrower ${p.borrowerId}`,
      );
      continue;
    }
    if (singleVin && vin !== singleVin) continue;

    inputs.push({
      policyId: policyDoc.id,
      organizationId: orgId,
      borrowerId: p.borrowerId,
      vehicleId: p.vehicleId,
      vin,
      borrowerLastName: borrower.lastName,
      borrowerFirstName: borrower.firstName,
      policyNumber: p.policyNumber,
      insuranceProvider: p.insuranceProvider ?? "State Farm",
    });
  }

  return inputs;
}

async function waitForUserOnPolicySearch(
  page: Page,
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  while (true) {
    console.log(
      "\n=========================================================\n" +
        "  ACTION REQUIRED\n" +
        "  1. Log into State Farm in the opened browser window.\n" +
        "  2. Complete any MFA prompts.\n" +
        "  3. Click into the Insurance Inquiry Tool until you see\n" +
        "     the Policy Search page (VIN + Policy Number fields).\n" +
        "  4. Come back here and press ENTER to start the sweep.\n" +
        "=========================================================",
    );
    await rl.question("Press ENTER when you're on the Policy Search page... ");
    const url = page.url();
    if (url.includes(POLICY_SEARCH_URL_FRAGMENT)) {
      console.log(`[manual-sweep] Confirmed on Policy Search: ${url}`);
      return;
    }
    console.warn(
      `[manual-sweep] Current URL "${url}" does not look like the Policy Search page. ` +
        `Expected URL to contain "${POLICY_SEARCH_URL_FRAGMENT}". Please navigate there and try again.`,
    );
  }
}

async function navigateBackToPolicySearch(page: Page): Promise<boolean> {
  if (page.url().includes(POLICY_SEARCH_URL_FRAGMENT)) return true;
  try {
    await page.goto(POLICY_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (err) {
    console.warn(
      `[manual-sweep] Direct navigation to inquiry hub failed: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
  await page.waitForTimeout(2_000);
  // The hub page has a button/link to the Insurance Inquiry Tool. Click it
  // if present so we end up on /InsuranceInquiry/policySearch.
  const inquiryLink = page
    .locator("a, button")
    .filter({ hasText: /Insurance\s+Inquiry\s+Tool/i })
    .first();
  if (await inquiryLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await inquiryLink.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
  }
  return page.url().includes(POLICY_SEARCH_URL_FRAGMENT);
}

async function processOnePolicy(
  page: Page,
  carrier: StateFarmModule,
  input: VerificationInput,
  runId: string,
): Promise<VerificationResult> {
  const checkStart = Date.now();

  try {
    if (!(await navigateBackToPolicySearch(page))) {
      throw new Error(
        "Could not return to State Farm Policy Search page. Re-navigate there in the browser and re-run.",
      );
    }

    // Deterministic VIN fill + submit (existing engine logic).
    await carrier.prepareSearch(page, input);

    // LLM-driven optional auto-selection and extraction (small Gemini calls).
    const searchTasks = carrier.buildSearchTasks(input);
    let finalData: Record<string, unknown> = {};
    let totalSteps = 0;
    for (const task of searchTasks) {
      const loopResult = await agentLoop(page, task);
      totalSteps += loopResult.steps.length;
      if (loopResult.data) finalData = { ...finalData, ...loopResult.data };
      if (!loopResult.success) {
        throw new Error(loopResult.error ?? "Agent task failed");
      }
    }

    const result = carrier.normalizeResult(input, finalData);
    result.agentSteps = totalSteps;
    result.durationMs = Date.now() - checkStart;
    await writeResult(result, runId);
    return result;
  } catch (err) {
    const failResult: VerificationResult = {
      success: false,
      policyId: input.policyId,
      policyStatus: PolicyStatus.NOT_AVAILABLE,
      insuranceProvider: input.insuranceProvider,
      errorReason: err instanceof Error ? err.message : "Unknown error",
      agentSteps: 0,
      durationMs: Date.now() - checkStart,
    };
    await writeResult(failResult, runId).catch((writeErr) =>
      console.error(
        `[manual-sweep] Failed to persist error result for ${input.policyId}:`,
        writeErr,
      ),
    );
    return failResult;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const projectId = process.env.GCP_PROJECT_ID ?? "insurance-track-os";
  const db = new Firestore({ projectId });

  console.log(`[manual-sweep] Project: ${projectId}, Org: ${args.orgId}`);
  const policies = await loadPoliciesForOrg(db, args.orgId, args.singleVin);
  if (policies.length === 0) {
    console.log(
      "[manual-sweep] No State Farm policies found for this org" +
        (args.singleVin ? ` matching VIN ${args.singleVin}` : "") +
        ". Nothing to do.",
    );
    return;
  }
  console.log(
    `[manual-sweep] Loaded ${policies.length} State Farm polic${
      policies.length === 1 ? "y" : "ies"
    } to verify.`,
  );

  mkdirSync(PROFILE_DIR, { recursive: true });
  const context: BrowserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !args.headed,
    viewport: { width: 1366, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] ?? (await context.newPage());

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    await page.goto("https://apps.b2b.statefarm.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitForUserOnPolicySearch(page, rl);

    const carrier = new StateFarmModule();
    const runId = `manual_${Date.now()}_${args.orgId}_state_farm`;
    console.log(`[manual-sweep] Starting sweep runId=${runId}`);

    const summary: { vin: string; policyId: string; status: string; reason?: string }[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < policies.length; i++) {
      const p = policies[i];
      console.log(
        `\n[manual-sweep] (${i + 1}/${policies.length}) Verifying VIN ${p.vin} (policy ${p.policyId})`,
      );
      const result = await processOnePolicy(page, carrier, p, runId);
      if (result.success) {
        successCount++;
        summary.push({
          vin: p.vin,
          policyId: p.policyId,
          status: result.policyStatus,
        });
        console.log(
          `[manual-sweep]   OK  status=${result.policyStatus} steps=${result.agentSteps} ${result.durationMs}ms`,
        );
      } else {
        errorCount++;
        summary.push({
          vin: p.vin,
          policyId: p.policyId,
          status: "ERROR",
          reason: result.errorReason,
        });
        console.warn(
          `[manual-sweep]   ERR ${result.errorReason ?? "unknown"} (${result.durationMs}ms)`,
        );
      }
    }

    console.log(
      `\n[manual-sweep] Done. ${successCount} verified, ${errorCount} errors out of ${policies.length}.`,
    );
    for (const row of summary) {
      console.log(
        `  ${row.vin}  ${row.policyId}  ${row.status}` +
          (row.reason ? `  - ${row.reason}` : ""),
      );
    }
  } finally {
    rl.close();
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[manual-sweep] Fatal:", err);
  process.exit(1);
});
