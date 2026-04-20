import "dotenv/config";
import express from "express";
import { launchBrowser } from "./browser/index.js";
import { agentLoop } from "./agent/loop.js";
import { getCarrierModule } from "./carriers/registry.js";
import { getCarrierCredentials } from "./credentials/store.js";
import { writeResult } from "./results/writer.js";
import type { VerificationBatch, BatchResult, VerificationResult } from "./types/index.js";
import { PolicyStatus } from "./types/index.js";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT ?? "8080", 10);

/** Health check for Cloud Run */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * POST /verify
 * Receives a batch of policies to verify for a single carrier.
 * Launches a browser session, logs into the carrier portal once,
 * then processes each policy sequentially within that session.
 */
app.post("/verify", async (req, res) => {
  const batch = req.body as VerificationBatch;

  if (!batch?.policies?.length || !batch.carrier) {
    res.status(400).json({ error: "Invalid batch: missing carrier or policies" });
    return;
  }

  console.log(
    `[verify] Starting batch ${batch.batchId} — carrier=${batch.carrier}, policies=${batch.policies.length}`
  );

  const batchStart = Date.now();
  const results: VerificationResult[] = [];

  // Resolve carrier module
  const carrierModule = getCarrierModule(batch.carrier);
  if (!carrierModule) {
    res.status(400).json({ error: `Unsupported carrier: ${batch.carrier}` });
    return;
  }

  // All policies in a batch share the same org — grab master credentials
  const credentials = await getCarrierCredentials(carrierModule.carrierId);
  if (!credentials) {
    res.status(400).json({
      error: `No master credentials configured for ${carrierModule.carrierName}`,
    });
    return;
  }

  let session;
  try {
    session = await launchBrowser();
    console.log(`[verify] Browser launched for batch ${batch.batchId}`);

    // Navigate to portal and login
    await session.page.goto(carrierModule.portalUrl, { waitUntil: "domcontentloaded" });
    const loginTasks = carrierModule.buildLoginTasks(credentials);
    for (const task of loginTasks) {
      const loginResult = await agentLoop(session.page, task);
      if (!loginResult.success) {
        res.status(500).json({
          error: `Login failed for ${carrierModule.carrierName}`,
          detail: loginResult.error,
        });
        return;
      }
    }
    console.log(`[verify] Logged into ${carrierModule.carrierName} portal`);

    // Process each policy
    for (const policy of batch.policies) {
      const checkStart = Date.now();
      try {
        // Check session is still alive before each policy
        const active = await carrierModule.isSessionActive(session.page);
        if (!active) {
          console.warn(`[verify] Session expired, re-logging into ${carrierModule.carrierName}`);
          await session.page.goto(carrierModule.portalUrl, { waitUntil: "domcontentloaded" });
          const reloginTasks = carrierModule.buildLoginTasks(credentials);
          for (const task of reloginTasks) {
            await agentLoop(session.page, task);
          }
        }

        // Run search + extraction tasks
        const searchTasks = carrierModule.buildSearchTasks(policy);
        let finalData: Record<string, unknown> = {};
        let totalSteps = 0;

        for (const task of searchTasks) {
          const loopResult = await agentLoop(session.page, task);
          totalSteps += loopResult.steps.length;
          if (loopResult.data) {
            finalData = { ...finalData, ...loopResult.data };
          }
          if (!loopResult.success) {
            throw new Error(loopResult.error ?? "Agent task failed");
          }
        }

        // Normalize results
        const result = carrierModule.normalizeResult(policy, finalData);
        result.agentSteps = totalSteps;
        result.durationMs = Date.now() - checkStart;
        results.push(result);

        // Persist to Firestore
        await writeResult(result, batch.runId);
      } catch (err) {
        const failResult: VerificationResult = {
          success: false,
          policyId: policy.policyId,
          policyStatus: PolicyStatus.NOT_AVAILABLE,
          insuranceProvider: policy.insuranceProvider,
          errorReason: err instanceof Error ? err.message : "Unknown error",
          agentSteps: 0,
          durationMs: Date.now() - checkStart,
        };
        results.push(failResult);

        // Persist failure to Firestore
        await writeResult(failResult, batch.runId).catch((writeErr) =>
          console.error(`[verify] Failed to write error result for ${policy.policyId}:`, writeErr)
        );
      }
    }
  } catch (err) {
    console.error(`[verify] Browser launch failed for batch ${batch.batchId}:`, err);
    res.status(500).json({
      error: "Browser launch failed",
      detail: err instanceof Error ? err.message : "Unknown error",
    });
    return;
  } finally {
    await session?.close();
  }

  const response: BatchResult = {
    batchId: batch.batchId,
    runId: batch.runId,
    results,
    totalDurationMs: Date.now() - batchStart,
  };

  console.log(
    `[verify] Batch ${batch.batchId} complete — ` +
      `success=${results.filter((r) => r.success).length}/${results.length}, ` +
      `duration=${response.totalDurationMs}ms`
  );

  res.json(response);
});

/**
 * POST /verify-test
 * Same as /verify but accepts inline credentials in the request body.
 * Used for local smoke testing when Firestore ADC is unavailable.
 * Should NOT be exposed in production.
 */
app.post("/verify-test", async (req, res) => {
  const { carrier, vin, policyNumber, credentials } = req.body as {
    carrier: string;
    vin: string;
    policyNumber?: string;
    credentials: { username: string; password: string };
  };

  if (!carrier || !vin || !credentials?.username || !credentials?.password) {
    res.status(400).json({ error: "carrier, vin, and credentials (username/password) are required" });
    return;
  }

  const carrierModule = getCarrierModule(carrier);
  if (!carrierModule) {
    res.status(400).json({ error: `Unsupported carrier: ${carrier}` });
    return;
  }

  console.log(`[verify-test] carrier=${carrier}, vin=${vin}`);
  const start = Date.now();

  let session;
  try {
    session = await launchBrowser();
    console.log("[verify-test] Browser launched, navigating to portal...");
    await session.page.goto(carrierModule.portalUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("[verify-test] Portal loaded, starting login...");

    // Login
    const loginTasks = carrierModule.buildLoginTasks(credentials);
    for (const task of loginTasks) {
      const loginResult = await agentLoop(session.page, task);
      if (!loginResult.success) {
        res.status(500).json({ error: "Login failed", detail: loginResult.error });
        return;
      }
    }
    console.log(`[verify-test] Logged into ${carrierModule.carrierName}`);

    // Search
    const searchTasks = carrierModule.buildSearchTasks({
      policyId: "test",
      organizationId: "test",
      borrowerId: "test",
      vehicleId: "test",
      vin,
      policyNumber,
      borrowerLastName: "",
      insuranceProvider: carrier,
    });

    let finalData: Record<string, unknown> = {};
    for (const task of searchTasks) {
      const result = await agentLoop(session.page, task);
      if (result.data) finalData = { ...finalData, ...result.data };
      if (!result.success) {
        res.status(500).json({ error: "Search/extraction failed", detail: result.error, partialData: finalData });
        return;
      }
    }

    res.json({ success: true, data: finalData, durationMs: Date.now() - start });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  } finally {
    await session?.close();
  }
});

import { isDirectSearchCapable } from "./carriers/types.js";
import { SessionExpiredError } from "./carriers/progressive/module.js";

/**
 * POST /verify-hybrid
 * Hybrid verification: AI login once → direct HTTP search for each policy.
 * Much faster than full AI search — one login handles hundreds of policies.
 */
app.post("/verify-hybrid", async (req, res) => {
  const batch = req.body as VerificationBatch;

  if (!batch?.policies?.length || !batch.carrier) {
    res.status(400).json({ error: "Invalid batch: missing carrier or policies" });
    return;
  }

  const carrierModule = getCarrierModule(batch.carrier);
  if (!carrierModule || !isDirectSearchCapable(carrierModule)) {
    res.status(400).json({
      error: `Carrier ${batch.carrier} does not support hybrid mode`,
    });
    return;
  }

  const credentials = await getCarrierCredentials(carrierModule.carrierId);
  if (!credentials) {
    res.status(400).json({
      error: `No master credentials configured for ${carrierModule.carrierName}`,
    });
    return;
  }

  console.log(
    `[verify-hybrid] Starting batch ${batch.batchId} — ${batch.policies.length} policies`
  );
  const batchStart = Date.now();
  const results: VerificationResult[] = [];

  // Login once via AI agent — this is the slow part (~60-90s)
  let session = await carrierModule.createSession(credentials);
  console.log("[verify-hybrid] Session created, starting HTTP searches...");

  // Throttle: ~2-3 requests/sec with random jitter
  const BASE_DELAY_MS = 350;
  const JITTER_MS = 200;

  for (let i = 0; i < batch.policies.length; i++) {
    const policy = batch.policies[i];

    // Re-login if session is stale
    if (!carrierModule.isSessionValid(session)) {
      console.log("[verify-hybrid] Session expired, re-logging in...");
      session = await carrierModule.createSession(credentials);
    }

    try {
      const result = await carrierModule.searchDirect(session, policy);
      results.push(result);
      await writeResult(result, batch.runId);
      console.log(
        `[verify-hybrid] ${i + 1}/${batch.policies.length} — ${policy.vin} → ${result.policyStatus} (${result.durationMs}ms)`
      );
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        console.log("[verify-hybrid] Session expired mid-search, re-logging in...");
        session = await carrierModule.createSession(credentials);
        i--; // retry this policy
        continue;
      }

      const failResult: VerificationResult = {
        success: false,
        policyId: policy.policyId,
        policyStatus: PolicyStatus.NOT_AVAILABLE,
        insuranceProvider: policy.insuranceProvider,
        errorReason: err instanceof Error ? err.message : "Unknown error",
        agentSteps: 0,
        durationMs: 0,
      };
      results.push(failResult);
      await writeResult(failResult, batch.runId).catch((writeErr) =>
        console.error(`[verify-hybrid] Failed to write error result:`, writeErr)
      );
    }

    // Throttle between requests
    if (i < batch.policies.length - 1) {
      const delay = BASE_DELAY_MS + Math.random() * JITTER_MS;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const response: BatchResult = {
    batchId: batch.batchId,
    runId: batch.runId,
    results,
    totalDurationMs: Date.now() - batchStart,
  };

  console.log(
    `[verify-hybrid] Batch complete — ${results.filter((r) => r.success).length}/${results.length} success, ${response.totalDurationMs}ms total`
  );

  res.json(response);
});

app.listen(PORT, () => {
  console.log(`Data Feed Engine listening on port ${PORT}`);
});
