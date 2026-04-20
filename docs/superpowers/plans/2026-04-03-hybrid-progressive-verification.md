# Hybrid Progressive Verification — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow AI-per-search flow with a hybrid approach: use the AI agent only for login+OTP, then capture session cookies and switch to direct HTTP requests for high-speed policy searches.

**Architecture:** Playwright+Gemini handles the complex multi-step login (credentials, user agreement, 2FA email OTP). Once logged in, we extract the session cookies and intercept the PROVE portal's XHR/API calls to discover the search and detail endpoints. A lightweight HTTP client then replays those calls for each policy — no browser, no AI, no screenshots. One login session handles hundreds of searches. If the session expires, re-login automatically.

**Tech Stack:** Playwright (login only), Node.js native fetch (search), existing Gemini 2.0 Flash (login reasoning), ImapFlow (OTP), Firestore (results)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `engine/src/carriers/progressive/http-client.ts` | **Create** | Direct HTTP search+detail client for PROVE portal |
| `engine/src/carriers/progressive/session.ts` | **Create** | Session manager — AI login, cookie extraction, session health |
| `engine/src/carriers/progressive/api-types.ts` | **Create** | TypeScript types for PROVE API request/response shapes |
| `engine/src/carriers/progressive/module.ts` | **Modify** | Add `searchDirect()` method alongside existing AI search |
| `engine/src/carriers/types.ts` | **Modify** | Add `DirectSearchCapable` interface for hybrid carriers |
| `engine/src/index.ts` | **Modify** | Add `/verify-hybrid` endpoint, update `/verify` to use hybrid when available |
| `engine/src/browser/pool.ts` | **Modify** | Add `extractCookies()` helper to `BrowserSession` |

---

## Chunk 1: Network Interception — Discover PROVE API

Before writing any production code, we need to capture the actual HTTP calls the PROVE portal makes when you search for a policy. We do this by intercepting network requests in Playwright during a manual-ish flow.

### Task 1: Build Network Capture Script

**Files:**
- Create: `engine/scripts/capture-prove-api.ts`

- [ ] **Step 1: Create the network capture script**

This script logs into PROVE using Playwright (headless: false so we can watch), intercepts all XHR/fetch requests, and logs the search API calls.

```typescript
// engine/scripts/capture-prove-api.ts
import "dotenv/config";
import { chromium } from "playwright";
import { agentLoop } from "../src/agent/loop.js";
import { observe } from "../src/agent/observer.js";
import { fetchOtpCode } from "../src/email/otp-reader.js";
import * as fs from "fs";

const PROVE_URL = "https://prove.progressive.com";
const USERNAME = "autoLT";
const PASSWORD = "Vikings2!";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
}

interface CapturedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
}

async function main() {
  const captured: { requests: CapturedRequest[]; responses: CapturedResponse[] } = {
    requests: [],
    responses: [],
  };

  const browser = await chromium.launch({ headless: false }); // visible for debugging
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // Intercept ALL network requests
  page.on("request", (req) => {
    if (["xhr", "fetch"].includes(req.resourceType())) {
      captured.requests.push({
        url: req.url(),
        method: req.method(),
        headers: req.headers(),
        postData: req.postData() ?? undefined,
        resourceType: req.resourceType(),
      });
      console.log(`[REQ] ${req.method()} ${req.url()}`);
      if (req.postData()) console.log(`  BODY: ${req.postData()?.substring(0, 500)}`);
    }
  });

  page.on("response", async (res) => {
    if (["xhr", "fetch"].includes(res.request().resourceType())) {
      let body: string | undefined;
      try {
        body = await res.text();
      } catch {}
      captured.responses.push({
        url: res.url(),
        status: res.status(),
        headers: res.headers(),
        body: body?.substring(0, 5000),
      });
      console.log(`[RES] ${res.status()} ${res.url()}`);
      if (body) console.log(`  BODY: ${body.substring(0, 300)}`);
    }
  });

  // Navigate and login using the AI agent
  console.log("Navigating to PROVE portal...");
  await page.goto(PROVE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  console.log("Starting AI login...");
  const loginTask = {
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
  };

  const loginResult = await agentLoop(page, loginTask);
  if (!loginResult.success) {
    console.error("Login failed:", loginResult.error);
    await browser.close();
    return;
  }

  console.log("\n=== LOGIN SUCCESSFUL ===\n");

  // Extract cookies
  const cookies = await context.cookies();
  console.log("\n=== SESSION COOKIES ===");
  cookies.forEach((c) => console.log(`  ${c.name}=${c.value.substring(0, 30)}...  domain=${c.domain}`));

  // Now perform a search using the UI while capturing network calls
  console.log("\n=== PERFORMING SEARCH (capturing API calls) ===\n");

  // Clear captured to only get search-related calls
  captured.requests.length = 0;
  captured.responses.length = 0;

  // Search using AI agent for one policy to capture the API calls
  const searchTask = {
    goal: `Search for a vehicle using "Full VIN or HIN" mode with VIN "1GTR1VE04CZ348426". Select the "Full VIN or HIN" radio button, leave vehicle type as "Auto", enter the full VIN, and click Submit.`,
    context: `You are on the Progressive PROVE "Find a Policy" page.
Select "Full VIN or HIN" radio, enter VIN, click Submit.
Full VIN: 1GTR1VE04CZ348426`,
  };

  const searchResult = await agentLoop(page, searchTask);
  console.log("\nSearch result:", searchResult.success);

  // Wait for any remaining network activity
  await page.waitForTimeout(3000);

  // Save all captured data
  fs.writeFileSync(
    "captured-prove-api.json",
    JSON.stringify(captured, null, 2)
  );
  console.log("\n=== SAVED captured-prove-api.json ===");
  console.log(`Total XHR requests captured: ${captured.requests.length}`);
  console.log(`Total XHR responses captured: ${captured.responses.length}`);

  // Don't close — let developer inspect
  console.log("\nBrowser staying open for inspection. Press Ctrl+C to exit.");
  await new Promise(() => {}); // hang forever
}

main().catch(console.error);
```

- [ ] **Step 2: Build and run the capture script**

```bash
cd engine
npx tsc
node dist/scripts/capture-prove-api.js 2>&1 | tee capture-output.txt
```

Watch the console for `[REQ]` and `[RES]` lines. The key API calls to find:
- The search endpoint (POST with VIN or policy number)
- The results/detail endpoint (GET with policy ID)
- Any CSRF tokens or anti-forgery headers

- [ ] **Step 3: Analyze captured API calls and document endpoints**

From captured-prove-api.json, identify:
1. **Search URL** — the POST/GET that submits a VIN search
2. **Search request format** — headers, body shape, CSRF tokens
3. **Search response format** — JSON or HTML? What fields?
4. **Detail URL** — the endpoint that returns full policy details
5. **Required cookies** — which cookie names are needed for auth
6. **Required headers** — Referer, X-CSRF-Token, etc.

Document everything in `engine/src/carriers/progressive/api-types.ts`.

---

## Chunk 2: Session Manager — AI Login + Cookie Extraction

### Task 2: Add cookie extraction to BrowserSession

**Files:**
- Modify: `engine/src/browser/pool.ts`

- [ ] **Step 1: Add cookies getter to BrowserSession**

```typescript
// Add to BrowserSession interface
export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
  getCookies: () => Promise<Array<{ name: string; value: string; domain: string; path: string }>>;
}

// In launchBrowser(), add to the return:
const getCookies = async () => {
  const cookies = await context.cookies();
  return cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
};

return { browser, context, page, close, getCookies };
```

- [ ] **Step 2: Verify build passes**

```bash
cd engine && npx tsc --noEmit
```

### Task 3: Create Progressive Session Manager

**Files:**
- Create: `engine/src/carriers/progressive/session.ts`

- [ ] **Step 1: Create the session manager**

This module owns the login lifecycle. It launches a browser, runs the AI login agent, extracts cookies, then closes the browser. The cookies are returned for use by the HTTP client.

```typescript
// engine/src/carriers/progressive/session.ts
import { launchBrowser, type BrowserSession } from "../../browser/pool.js";
import { agentLoop } from "../../agent/loop.js";
import type { CarrierCredentialPayload } from "../../types/credentials.js";
import { LOGIN_CONTEXT } from "./prompts.js";

const PROVE_URL = "https://prove.progressive.com";

export interface ProveSession {
  cookies: Record<string, string>;
  /** Headers needed for API calls (referer, CSRF, etc.) — filled after capture analysis */
  headers: Record<string, string>;
  /** When this session was created */
  createdAt: Date;
  /** Base URL for API calls */
  baseUrl: string;
}

/**
 * Logs into PROVE using the AI agent, extracts session cookies,
 * closes the browser, and returns a lightweight session object
 * that can be used for direct HTTP calls.
 */
export async function createProveSession(
  credentials: CarrierCredentialPayload
): Promise<ProveSession> {
  let session: BrowserSession | undefined;

  try {
    session = await launchBrowser();
    console.log("[prove-session] Browser launched, navigating to portal...");

    await session.page.goto(PROVE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Run AI login
    const loginTask = {
      goal: `Log into the Progressive PROVE portal. Enter credentials, accept the user agreement, complete 2-step email verification, and reach the "Find a Policy" search page.`,
      context:
        LOGIN_CONTEXT +
        `\n\nUsername: ${credentials.username}\nPassword: ${credentials.password}`,
    };

    const loginResult = await agentLoop(session.page, loginTask);
    if (!loginResult.success) {
      throw new Error(`PROVE login failed: ${loginResult.error}`);
    }

    console.log("[prove-session] Login successful, extracting cookies...");

    // Extract cookies
    const rawCookies = await session.getCookies();
    const cookies: Record<string, string> = {};
    for (const c of rawCookies) {
      if (c.domain.includes("progressive.com")) {
        cookies[c.name] = c.value;
      }
    }

    // Extract any CSRF tokens or meta tags from the page
    const headers: Record<string, string> = {
      Referer: session.page.url(),
      Origin: "https://prove.progressive.com",
    };

    // Try to grab CSRF token from page meta or cookies
    const csrfToken = await session.page
      .evaluate(() => {
        const meta = document.querySelector(
          'meta[name="csrf-token"], meta[name="_csrf"], meta[name="__RequestVerificationToken"]'
        );
        return meta?.getAttribute("content") ?? null;
      })
      .catch(() => null);

    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    console.log(
      `[prove-session] Extracted ${Object.keys(cookies).length} cookies`
    );

    return {
      cookies,
      headers,
      createdAt: new Date(),
      baseUrl: PROVE_URL,
    };
  } finally {
    // Always close the browser — we only need the cookies
    await session?.close();
    console.log("[prove-session] Browser closed");
  }
}

/** Convert cookies object to a Cookie header string */
export function cookieString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** Check if a session is likely still valid (age-based heuristic) */
export function isSessionFresh(session: ProveSession, maxAgeMs = 25 * 60 * 1000): boolean {
  return Date.now() - session.createdAt.getTime() < maxAgeMs;
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd engine && npx tsc --noEmit
```

---

## Chunk 3: HTTP Search Client

This chunk depends on the API discovery from Chunk 1. The exact URLs, request shapes, and response formats will be filled in after running the capture script.

### Task 4: Define PROVE API types

**Files:**
- Create: `engine/src/carriers/progressive/api-types.ts`

- [ ] **Step 1: Create API type file (placeholder — update after capture)**

```typescript
// engine/src/carriers/progressive/api-types.ts
// These types will be finalized after running the capture script (Task 1).

/** Search request to PROVE search API */
export interface ProveSearchRequest {
  // TODO: Fill from captured API data
  searchType: "vin" | "policy";
  vin?: string;
  policyNumber?: string;
  vinLast6?: string;
  vehicleType?: string;
}

/** Single result from a PROVE search */
export interface ProveSearchResult {
  // TODO: Fill from captured API response
  policyNumber: string;
  policyStatus: string;
  namedInsured: string;
  vehicleVin: string;
  vehicleDescription: string;
}

/** Full policy detail from PROVE */
export interface ProvePolicyDetail {
  // TODO: Fill from captured API response
  policyNumber: string;
  policyStatus: string;
  namedInsured: string;
  effectiveDate: string;
  expirationDate: string;
  vehicles: Array<{
    vin: string;
    year: string;
    make: string;
    model: string;
  }>;
  coverages: Array<{
    type: string;
    deductible?: number;
    limit?: number;
  }>;
  lienholders: Array<{
    name: string;
    address: string;
  }>;
  drivers: string[];
}
```

### Task 5: Build the HTTP search client

**Files:**
- Create: `engine/src/carriers/progressive/http-client.ts`

- [ ] **Step 1: Create the HTTP client**

```typescript
// engine/src/carriers/progressive/http-client.ts
import type { ProveSearchRequest, ProveSearchResult, ProvePolicyDetail } from "./api-types.js";
import { cookieString, type ProveSession } from "./session.js";

const SEARCH_ENDPOINT = "/api/search";   // TODO: Update after capture
const DETAIL_ENDPOINT = "/api/policy";   // TODO: Update after capture

/**
 * Performs a policy search via direct HTTP (no browser).
 * Uses session cookies from AI login.
 */
export async function searchPolicy(
  session: ProveSession,
  request: ProveSearchRequest
): Promise<ProveSearchResult[]> {
  const url = `${session.baseUrl}${SEARCH_ENDPOINT}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieString(session.cookies),
      ...session.headers,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SessionExpiredError("Session expired during search");
    }
    throw new Error(`PROVE search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  // TODO: Map response to ProveSearchResult[] after capture
  return data as ProveSearchResult[];
}

/**
 * Fetches full policy details via direct HTTP.
 */
export async function getPolicyDetail(
  session: ProveSession,
  policyId: string
): Promise<ProvePolicyDetail> {
  const url = `${session.baseUrl}${DETAIL_ENDPOINT}/${policyId}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Cookie: cookieString(session.cookies),
      ...session.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SessionExpiredError("Session expired during detail fetch");
    }
    throw new Error(`PROVE detail failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  // TODO: Map response to ProvePolicyDetail after capture
  return data as ProvePolicyDetail;
}

/** Thrown when the session cookies are no longer valid */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd engine && npx tsc --noEmit
```

---

## Chunk 4: Hybrid Verify Endpoint

### Task 6: Add DirectSearchCapable interface

**Files:**
- Modify: `engine/src/carriers/types.ts`

- [ ] **Step 1: Add the interface**

Add after the existing `CarrierModule` interface:

```typescript
import type { VerificationInput, VerificationResult } from "../types/verification.js";
import type { CarrierCredentialPayload } from "../types/credentials.js";

/**
 * Carriers that support direct HTTP search after AI login.
 * This enables the hybrid flow: AI login → HTTP search at scale.
 */
export interface DirectSearchCapable {
  /** 
   * Login via AI agent, extract session, return an opaque session object.
   * The session is reusable for many searches.
   */
  createSession(credentials: CarrierCredentialPayload): Promise<unknown>;

  /**
   * Search for a single policy using the session (no browser).
   * Throws SessionExpiredError if the session is no longer valid.
   */
  searchDirect(session: unknown, input: VerificationInput): Promise<VerificationResult>;

  /** Check if the session is still likely valid */
  isSessionValid(session: unknown): boolean;
}

/** Type guard to check if a carrier supports direct search */
export function isDirectSearchCapable(mod: CarrierModule): mod is CarrierModule & DirectSearchCapable {
  return "searchDirect" in mod && "createSession" in mod;
}
```

### Task 7: Update Progressive module with DirectSearchCapable

**Files:**
- Modify: `engine/src/carriers/progressive/module.ts`

- [ ] **Step 1: Implement DirectSearchCapable on ProgressiveModule**

Add the three methods to the existing class. The `searchDirect` method calls the HTTP client and normalizes the result.

```typescript
// Add imports at top
import type { DirectSearchCapable } from "../types.js";
import { createProveSession, isSessionFresh, type ProveSession } from "./session.js";
import { searchPolicy, getPolicyDetail, SessionExpiredError } from "./http-client.js";

// Add to class declaration:
// export class ProgressiveModule implements CarrierModule, DirectSearchCapable {

  async createSession(credentials: CarrierCredentialPayload): Promise<ProveSession> {
    return createProveSession(credentials);
  }

  async searchDirect(session: unknown, input: VerificationInput): Promise<VerificationResult> {
    const proveSession = session as ProveSession;
    const start = Date.now();

    try {
      // Search by VIN or policy number
      const results = await searchPolicy(proveSession, {
        searchType: input.policyNumber ? "policy" : "vin",
        vin: input.vin,
        policyNumber: input.policyNumber,
        vinLast6: input.vin.slice(-6),
        vehicleType: "Auto",
      });

      if (!results.length) {
        return {
          success: false,
          policyId: input.policyId,
          policyStatus: PolicyStatus.NOT_AVAILABLE,
          insuranceProvider: "Progressive",
          errorReason: "No results found for VIN",
          agentSteps: 0,
          durationMs: Date.now() - start,
        };
      }

      // Get full detail for the first matching result
      const detail = await getPolicyDetail(proveSession, results[0].policyNumber);

      // Map to VerificationResult using existing normalizeResult
      const rawData: Record<string, unknown> = {
        policyNumber: detail.policyNumber,
        policyStatus: detail.policyStatus,
        namedInsured: detail.namedInsured,
        effectiveDate: detail.effectiveDate,
        expirationDate: detail.expirationDate,
        // Map coverages
        hasComprehensive: detail.coverages.some(c => c.type.toLowerCase().includes("comprehensive")),
        comprehensiveDeductible: detail.coverages.find(c => c.type.toLowerCase().includes("comprehensive"))?.deductible,
        hasCollision: detail.coverages.some(c => c.type.toLowerCase().includes("collision")),
        collisionDeductible: detail.coverages.find(c => c.type.toLowerCase().includes("collision"))?.deductible,
        liabilityLimit: detail.coverages.find(c => c.type.toLowerCase().includes("liability"))?.limit,
        lienholderName: detail.lienholders[0]?.name,
        lienholderAddress: detail.lienholders[0]?.address,
        drivers: detail.drivers.join(", "),
      };

      const result = this.normalizeResult(input, rawData);
      result.agentSteps = 0; // no AI steps for search
      result.durationMs = Date.now() - start;
      return result;
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err; // let caller re-login
      return {
        success: false,
        policyId: input.policyId,
        policyStatus: PolicyStatus.NOT_AVAILABLE,
        insuranceProvider: "Progressive",
        errorReason: err instanceof Error ? err.message : "Unknown error",
        agentSteps: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  isSessionValid(session: unknown): boolean {
    return isSessionFresh(session as ProveSession);
  }
```

### Task 8: Add hybrid verify endpoint

**Files:**
- Modify: `engine/src/index.ts`

- [ ] **Step 1: Add the `/verify-hybrid` endpoint**

This endpoint uses AI login once, then processes all policies via direct HTTP. It auto-re-logins if the session expires mid-batch.

```typescript
import { isDirectSearchCapable } from "./carriers/types.js";
import { SessionExpiredError } from "./carriers/progressive/http-client.js";

app.post("/verify-hybrid", async (req, res) => {
  const batch = req.body as VerificationBatch;

  if (!batch?.policies?.length || !batch.carrier) {
    res.status(400).json({ error: "Invalid batch" });
    return;
  }

  const carrierModule = getCarrierModule(batch.carrier);
  if (!carrierModule || !isDirectSearchCapable(carrierModule)) {
    res.status(400).json({ error: `Carrier ${batch.carrier} does not support hybrid mode` });
    return;
  }

  const credentials = await getCarrierCredentials(carrierModule.carrierId);
  if (!credentials) {
    res.status(400).json({ error: `No credentials for ${carrierModule.carrierName}` });
    return;
  }

  console.log(`[verify-hybrid] Starting batch ${batch.batchId} — ${batch.policies.length} policies`);
  const batchStart = Date.now();
  const results: VerificationResult[] = [];

  // Login once via AI agent
  let session = await carrierModule.createSession(credentials);
  console.log(`[verify-hybrid] Session created, starting searches...`);

  // Throttle: ~2-3 requests/sec with jitter
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
      console.log(`[verify-hybrid] ${i + 1}/${batch.policies.length} — ${policy.vin} → ${result.policyStatus}`);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        // Re-login and retry this policy
        console.log("[verify-hybrid] Session expired mid-search, re-logging in...");
        session = await carrierModule.createSession(credentials);
        i--; // retry
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
      await writeResult(failResult, batch.runId).catch(() => {});
    }

    // Throttle with jitter
    if (i < batch.policies.length - 1) {
      const delay = BASE_DELAY_MS + Math.random() * JITTER_MS;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const response: BatchResult = {
    batchId: batch.batchId,
    runId: batch.runId,
    results,
    totalDurationMs: Date.now() - batchStart,
  };

  console.log(
    `[verify-hybrid] Batch complete — ${results.filter(r => r.success).length}/${results.length} success, ${response.totalDurationMs}ms`
  );

  res.json(response);
});
```

- [ ] **Step 2: Update `/verify` to prefer hybrid when available**

In the existing `/verify` endpoint, add a check at the top:

```typescript
// At the top of the /verify handler, after resolving carrierModule and credentials:
if (isDirectSearchCapable(carrierModule)) {
  // Forward to hybrid handler
  req.url = "/verify-hybrid";
  app.handle(req, res);
  return;
}
// ... rest of existing browser-based flow
```

- [ ] **Step 3: Build and verify**

```bash
cd engine && npx tsc --noEmit
```

---

## Chunk 5: Update Dispatcher for Hybrid

### Task 9: Update Cloud Functions dispatcher

**Files:**
- Modify: `functions/src/functions/data-feed-dispatcher.ts`

- [ ] **Step 1: Change endpoint from `/verify` to `/verify-hybrid` for Progressive**

The dispatcher currently POSTs to `ENGINE_URL/verify`. Update it to use `/verify-hybrid` when the carrier supports it (Progressive for now).

- [ ] **Step 2: Deploy functions**

```bash
firebase deploy --only functions
```

---

## Execution Order

1. **Chunk 1** (Task 1): Run capture script to discover PROVE API — this unlocks everything else
2. **Chunk 2** (Tasks 2-3): Build session manager with cookie extraction
3. **Chunk 3** (Tasks 4-5): Build HTTP client using discovered API
4. **Chunk 4** (Tasks 6-8): Wire up hybrid endpoint
5. **Chunk 5** (Task 9): Update dispatcher

**The critical dependency is Chunk 1** — we can't write the HTTP client until we know the API shapes. Everything else builds on that discovery.
