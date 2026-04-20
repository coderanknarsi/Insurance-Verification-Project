/**
 * Network Capture Script for Progressive PROVE Portal
 *
 * Logs into PROVE using the AI agent (Playwright + Gemini),
 * then intercepts all XHR/fetch requests during a VIN search
 * to discover the portal's internal API endpoints.
 *
 * Run:  cd engine && npx tsc && node dist/scripts/capture-prove-api.js
 */
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from engine root (works regardless of CWD)
config({ path: resolve(__dirname, "../../.env") });

import { chromium } from "playwright";
import { agentLoop } from "../agent/loop.js";
import * as fs from "fs";

const PROVE_URL = "https://prove.progressive.com";
const USERNAME = process.env.PROVE_USERNAME ?? "autoLT";
const PASSWORD = process.env.PROVE_PASSWORD ?? "Vikings2!";

// Two real Progressive policies to test with
const TEST_CASES = [
  { vin: "1GTR1VE04CZ348426", policyNumber: "872178941", label: "Patricia Evans / 2012 GMC Sierra" },
  { vin: "5FNRL5H65FB004527", policyNumber: "864861547", label: "Sarah Lerma / 2015 Honda Odyssey" },
];
const TEST_VIN = TEST_CASES[0].vin;
const TEST_POLICY = TEST_CASES[0].policyNumber;

interface CapturedRequest {
  timestamp: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
}

interface CapturedResponse {
  timestamp: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
}

async function main() {
  const allRequests: CapturedRequest[] = [];
  const allResponses: CapturedResponse[] = [];
  let phase = "login";

  const browser = await chromium.launch({
    headless: false, // visible for debugging — change to true in CI
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // Intercept ALL network calls
  page.on("request", (req) => {
    const rt = req.resourceType();
    if (["xhr", "fetch", "document"].includes(rt)) {
      const entry: CapturedRequest = {
        timestamp: new Date().toISOString(),
        url: req.url(),
        method: req.method(),
        headers: req.headers(),
        postData: req.postData() ?? undefined,
        resourceType: rt,
      };
      allRequests.push(entry);
      console.log(`[${phase}][REQ] ${req.method()} ${req.url()}`);
      if (req.postData()) {
        console.log(`  BODY: ${req.postData()!.substring(0, 500)}`);
      }
    }
  });

  page.on("response", async (res) => {
    const rt = res.request().resourceType();
    if (["xhr", "fetch", "document"].includes(rt)) {
      let body: string | undefined;
      try {
        body = await res.text();
      } catch {
        // some responses can't be read
      }
      const entry: CapturedResponse = {
        timestamp: new Date().toISOString(),
        url: res.url(),
        status: res.status(),
        headers: res.headers(),
        body: body ? body.substring(0, 10000) : undefined,
      };
      allResponses.push(entry);
      console.log(`[${phase}][RES] ${res.status()} ${res.url()}`);
      if (body) {
        console.log(`  BODY preview: ${body.substring(0, 300)}`);
      }
    }
  });

  // ──── Phase 1: Login ────
  console.log("\n═══ PHASE 1: LOGIN ═══\n");
  await page.goto(PROVE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  const loginResult = await agentLoop(page, {
    goal: `Log into the Progressive PROVE portal. Enter credentials, accept the user agreement, complete 2-step email verification, and reach the "Find a Policy" search page.`,
    context: `You are on the Progressive PROVE portal (https://prove.progressive.com).
This is an insurance lender verification portal for lienholders and insurance trackers.

The login flow has MULTIPLE screens you must navigate through:
1. LOGIN PAGE: Enter User ID and Password, click "Log in".
2. USER AGREEMENT PAGE: Scroll down and click "I agree".
3. 2-STEP VERIFICATION: Click "Email Me" then "Continue".
4. OTP CODE ENTRY: Return FETCH_MFA_CODE action — system fetches code automatically.
   After code is entered, click "Continue".

Username: ${USERNAME}
Password: ${PASSWORD}`,
  });

  if (!loginResult.success) {
    console.error("LOGIN FAILED:", loginResult.error);
    fs.writeFileSync("captured-prove-login-failed.json", JSON.stringify({ allRequests, allResponses }, null, 2));
    await browser.close();
    process.exit(1);
  }

  console.log("\n═══ LOGIN SUCCESSFUL ═══\n");

  // ──── Extract cookies ────
  const cookies = await context.cookies();
  console.log("\n=== SESSION COOKIES ===");
  for (const c of cookies) {
    console.log(`  ${c.name} = ${c.value.substring(0, 40)}...  (domain=${c.domain}, path=${c.path})`);
  }

  // Save login-phase captures
  const loginCapture = { requests: [...allRequests], responses: [...allResponses], cookies };
  fs.writeFileSync("captured-prove-login.json", JSON.stringify(loginCapture, null, 2));
  console.log(`\nSaved login capture: ${allRequests.length} requests, ${allResponses.length} responses\n`);

  // ──── Phase 2: Search by VIN ────
  phase = "search";
  // Reset to only capture search-related traffic
  const searchStartIdx = allRequests.length;

  console.log("\n═══ PHASE 2A: FULL VIN SEARCH ═══\n");
  console.log(`Testing: ${TEST_CASES[0].label}`);
  console.log(`VIN: ${TEST_VIN}\n`);

  const searchResult = await agentLoop(page, {
    goal: `Search for a vehicle using "Full VIN or HIN" mode with VIN "${TEST_VIN}". Select the "Full VIN or HIN" radio button, leave vehicle type as "Auto", enter the full VIN, and click Submit.`,
    context: `You are on the Progressive PROVE "Find a Policy" page.
Select "Full VIN or HIN" radio, enter VIN, click Submit.
Full VIN: ${TEST_VIN}`,
  });

  // Wait for search results to load
  await page.waitForTimeout(5000);

  console.log(`\nVIN Search result: success=${searchResult.success}`);
  if (searchResult.data) {
    console.log("VIN Search data:", JSON.stringify(searchResult.data, null, 2));
  }

  // ──── Phase 2B: Search by Policy Number ────
  // Navigate back to search page if needed and try policy number search
  console.log("\n═══ PHASE 2B: POLICY NUMBER SEARCH ═══\n");
  console.log(`Testing: ${TEST_CASES[0].label}`);
  console.log(`Policy: ${TEST_POLICY}, Last 6 of VIN: ${TEST_VIN.slice(-6)}\n`);
  phase = "policy-search";

  const policySearchResult = await agentLoop(page, {
    goal: `Search for a policy using "Policy number" mode. Select the "Policy number" radio button, enter the policy number and the last 6 characters of the VIN, then click Submit.`,
    context: `You are on the Progressive PROVE "Find a Policy" page (or search results page).
If you see a "New Search" or "Search Again" button/link, click it first to get back to the search form.
If you are already on the search form:
1. Select the "Policy number" radio button
2. Enter policy number: ${TEST_POLICY}
3. Enter the last 6 characters of VIN: ${TEST_VIN.slice(-6)}
4. Click "Submit"

Policy number: ${TEST_POLICY}
Last 6 of VIN: ${TEST_VIN.slice(-6)}`,
  });

  await page.waitForTimeout(5000);

  console.log(`\nPolicy Search result: success=${policySearchResult.success}`);
  if (policySearchResult.data) {
    console.log("Policy Search data:", JSON.stringify(policySearchResult.data, null, 2));
  }

  // ──── Phase 2C: Try second VIN ────
  console.log("\n═══ PHASE 2C: SECOND VIN SEARCH ═══\n");
  console.log(`Testing: ${TEST_CASES[1].label}`);
  console.log(`VIN: ${TEST_CASES[1].vin}\n`);
  phase = "search2";

  const search2Result = await agentLoop(page, {
    goal: `Search for a vehicle using "Full VIN or HIN" mode with VIN "${TEST_CASES[1].vin}". Select the "Full VIN or HIN" radio button, leave vehicle type as "Auto", enter the full VIN, and click Submit.`,
    context: `You are on the Progressive PROVE portal.
If you see a "New Search" or "Search Again" button/link, click it first to get back to the search form.
If you are already on the search form:
1. Select "Full VIN or HIN" radio button
2. Leave vehicle type as "Auto"
3. Enter the full VIN
4. Click "Submit"

Full VIN: ${TEST_CASES[1].vin}`,
  });

  await page.waitForTimeout(5000);

  console.log(`\nSecond VIN Search result: success=${search2Result.success}`);
  if (search2Result.data) {
    console.log("Second VIN Search data:", JSON.stringify(search2Result.data, null, 2));
  }

  // ──── Phase 3: Click result to get detail (if any search succeeded) ────
  const anySearchWorked = searchResult.success || policySearchResult.success || search2Result.success;

  let detailResult = { success: false, data: null as unknown } as { success: boolean; data?: unknown };
  if (anySearchWorked) {
    phase = "detail";
    console.log("\n═══ PHASE 3: POLICY DETAIL ═══\n");

    detailResult = await agentLoop(page, {
      goal: `Find and select the policy result to view full details.`,
      context: `You are viewing search results on the Progressive PROVE portal.
Look for the policy result displayed on the page.
Click on the policy to view full details including coverages, lienholders, and vehicle info.
If the page shows policy details already, extract what you can see.`,
    });

    await page.waitForTimeout(3000);
    console.log(`\nDetail result: success=${detailResult.success}`);
  } else {
    console.log("\n═══ SKIPPING PHASE 3 (all searches returned no results) ═══\n");
  }

  // ──── Save everything ────
  const searchRequests = allRequests.slice(searchStartIdx);
  const searchResponses = allResponses.filter(
    (r) => new Date(r.timestamp) >= new Date(allRequests[searchStartIdx]?.timestamp ?? 0)
  );

  const fullCapture = {
    loginPhase: loginCapture,
    searchPhase: {
      requests: searchRequests,
      responses: searchResponses,
    },
    allRequests,
    allResponses,
    cookies,
    vinSearchResult: searchResult.data,
    policySearchResult: policySearchResult.data,
    vinSearch2Result: search2Result.data,
    detailResult: detailResult.data,
  };

  fs.writeFileSync("captured-prove-api.json", JSON.stringify(fullCapture, null, 2));
  console.log(`\n═══ CAPTURE COMPLETE ═══`);
  console.log(`Total requests captured: ${allRequests.length}`);
  console.log(`Total responses captured: ${allResponses.length}`);
  console.log(`Search-phase requests: ${searchRequests.length}`);
  console.log(`Saved to: captured-prove-api.json`);

  // Keep browser open for manual inspection
  console.log("\nBrowser staying open for inspection. Press Ctrl+C to exit.");
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
