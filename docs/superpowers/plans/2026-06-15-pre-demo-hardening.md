# Pre-Demo Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Build tasks **one at a time, in order**, and stop for review after each task.

**Goal:** Close the highest-risk gaps before demoing to the dealership and DMS partners (Frazer), addressing two lenses — (1) protect the dealer/lender from a *false sense of security*, and (2) make the partner API a no-brainer for software platforms to adopt.

**Architecture:** Incremental hardening of the existing Firebase Functions (Gen2, Node 24) backend plus the Vite landing/Next.js dashboard. No new services. Each task is self-contained, independently committable, and deployed one function at a time (repo convention). Backend tests live in `functions/test/*.test.js` (node:test). Frontend changes follow existing component patterns.

**Tech Stack:** TypeScript, Firebase Functions Gen2, Firestore, Vite/React (landing), Next.js/React (dashboard), node:test.

**Build order (by ROI + dependency):**
1. Task A — Staleness/overdue signal (backend flag + dashboard banner)
2. Task B — Dealer alert on lapse + sweep failure
3. Task C — Rate limiting + payload size cap on `partnerDealsApi`
4. Task D — Sandbox/test API keys (`alt_test_`)
5. Task E — Webhook retries + partner-visible delivery status
6. Task F — "Coverage-only" labeling for unsupported carriers
7. Backlog — post-demo items (not scheduled here)

**Conventions to honor:**
- Deploy functions ONE at a time: `firebase deploy --only functions:NAME` from repo root.
- Build backend with `npm run build` in `functions/` before deploy.
- PowerShell: chain commands with `;` never `&&`.
- `git push` writes to stderr → Exit Code 1 can still be success; verify the `oldsha..newsha main -> main` line.
- Landing/dashboard deploy via `git push origin main` (Vercel); `.vercelignore` no longer excludes `landing/`.
- Do NOT create markdown docs for changes unless asked.

---

## Chunk 1: Dealer protection (Tasks A & B)

### Task A: Staleness / overdue verification signal

**Why:** Today the dashboard shows the last *successful* `lastVerifiedAt` and last GREEN status even when recent attempts failed or no sweep ran. A dealer can believe they are covered while data is weeks stale. This task makes freshness explicit, end-to-end.

**Design:** Add a pure helper that derives staleness from existing timestamps (no schema migration needed). Surface it in the org verification-status callable and render a banner + per-policy badge in the dashboard. Threshold: stale if `lastVerifiedAt` is older than the org's sweep cadence + grace (default **8 days**), or if `lastVerifiedAt` is missing for an in-scope policy.

**Files:**
- Create: `functions/src/services/verification-staleness.ts`
- Create: `functions/test/verification-staleness.test.js`
- Modify: `functions/src/functions/get-org-verification-status.ts` (add `staleCount` + `overduePolicyIds` to response)
- Modify: dashboard verification status view (frontend) — add banner + per-policy badge

- [x] **Step A1: Write the failing test for the staleness helper**

Create `functions/test/verification-staleness.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { isVerificationStale, STALE_THRESHOLD_MS } = require("../lib/services/verification-staleness");

test("fresh verification is not stale", () => {
  const now = Date.now();
  assert.equal(isVerificationStale({ lastVerifiedAtMs: now - 60_000, inScope: true }, now), false);
});

test("verification older than threshold is stale", () => {
  const now = Date.now();
  assert.equal(
    isVerificationStale({ lastVerifiedAtMs: now - STALE_THRESHOLD_MS - 1, inScope: true }, now),
    true,
  );
});

test("in-scope policy never verified is stale", () => {
  const now = Date.now();
  assert.equal(isVerificationStale({ lastVerifiedAtMs: null, inScope: true }, now), true);
});

test("out-of-scope policy (pending upload) is not flagged stale", () => {
  const now = Date.now();
  assert.equal(isVerificationStale({ lastVerifiedAtMs: null, inScope: false }, now), false);
});
```

- [x] **Step A2: Run the test to confirm it fails**

Run: `cd functions; npm run build; node --test test/verification-staleness.test.js`
Expected: FAIL — cannot find module `../lib/services/verification-staleness`.

- [x] **Step A3: Implement the helper**

Create `functions/src/services/verification-staleness.ts`:

```ts
/**
 * Derives "is this policy's verification stale?" purely from timestamps, so the
 * dashboard can warn a dealer that data is overdue instead of showing a green
 * status backed by a weeks-old (or failed) sweep.
 *
 * Stale when:
 *  - an in-scope policy has never been verified (no lastVerifiedAt), OR
 *  - lastVerifiedAt is older than the staleness threshold.
 * Out-of-scope policies (pending upload, etc.) are never flagged here.
 */
export const STALE_THRESHOLD_MS = 8 * 24 * 60 * 60 * 1000; // 8 days (weekly cadence + grace)

export interface StalenessInput {
  lastVerifiedAtMs: number | null;
  inScope: boolean;
}

export function isVerificationStale(
  input: StalenessInput,
  nowMs: number = Date.now(),
): boolean {
  if (!input.inScope) return false;
  if (input.lastVerifiedAtMs == null) return true;
  return nowMs - input.lastVerifiedAtMs > STALE_THRESHOLD_MS;
}
```

- [x] **Step A4: Run the test to confirm it passes**

Run: `cd functions; npm run build; node --test test/verification-staleness.test.js`
Expected: PASS (4/4).

- [x] **Step A5: Wire staleness into the org status callable**

In `functions/src/functions/get-org-verification-status.ts`:
- Import `isVerificationStale` from `../services/verification-staleness`.
- Treat `INSURED_SUPPORTED` (and `INSURED_UNSUPPORTED`, `INSURED_NO_CREDS`) as `inScope: true`; `PENDING_UPLOAD` as `inScope: false`.
- While iterating `policiesSnap.docs`, compute staleness per policy using `policyDoc.data().lastVerifiedAt?.toMillis?.() ?? null`.
- Add to the response interface and object:
  - `staleCount: number`
  - `overduePolicyIds: string[]` (cap at first 100 to bound payload)

- [x] **Step A6: Build and deploy the function**

Run: `cd functions; npm run build`
Then from repo root: `firebase deploy --only functions:getOrgVerificationStatus`
Expected: deploy succeeds.

- [x] **Step A7: Add the dashboard banner + per-policy badge**

Locate the dashboard component that renders org verification status / the portfolio grid (search the `frontend/src` tree for the `getOrgVerificationStatus` caller and the policy row component). Add:
- A top-of-portfolio banner shown when `staleCount > 0`: e.g. "⚠️ {staleCount} policies are overdue for verification (data older than 8 days)." Use existing alert/banner styling.
- A small "Overdue" badge on policy rows whose id is in `overduePolicyIds`.

Follow existing component, styling, and data-fetching patterns — do not introduce a new state library.

- [x] **Step A8: Verify the frontend builds**

Run: `cd frontend; npm run build`
Expected: build succeeds with no type errors.

- [x] **Step A9: Commit**

```powershell
git add functions/src/services/verification-staleness.ts functions/test/verification-staleness.test.js functions/src/functions/get-org-verification-status.ts frontend/src
git commit -m "feat(verification): flag stale/overdue policies in dashboard"
```

---

### Task B: Dealer alert on lapse + sweep failure

**Why:** Today the **borrower** is notified on lapse, but the **lender/dealer** is not, and nobody is told when a weekly sweep fails or completes with errors. The dealer can be unprotected without knowing. This task adds a same-day email digest to the org's admins.

**Design:** Reuse the existing lender-email service. Add a small dispatcher that, after a sweep run finalizes, emails org admins a summary (verified / failed / issues found) and a separate alert if the run failed outright. Keep delivery best-effort (never block result recording). Make it idempotent per run via a `dealerAlertSentAt` field on the run doc.

**Files:**
- Create: `functions/src/services/dealer-sweep-alert.ts`
- Create: `functions/test/dealer-sweep-alert.test.js`
- Modify: `functions/src/functions/manual-carrier-sweep.ts` (call dispatcher when a run finalizes)

- [x] **Step B1: Write the failing test for the summary builder**

Create `functions/test/dealer-sweep-alert.test.js` testing a pure `buildSweepAlert(summary)` that returns `{ subject, severity, lines }`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSweepAlert } = require("../lib/services/dealer-sweep-alert");

test("clean run produces an informational summary", () => {
  const a = buildSweepAlert({ total: 50, verified: 50, failed: 0, issuesFound: 0 });
  assert.equal(a.severity, "info");
  assert.match(a.subject, /50 verified/);
});

test("run with failures is flagged as a warning", () => {
  const a = buildSweepAlert({ total: 50, verified: 47, failed: 3, issuesFound: 2 });
  assert.equal(a.severity, "warning");
  assert.match(a.subject, /3 failed/);
});

test("fully failed run is flagged critical", () => {
  const a = buildSweepAlert({ total: 50, verified: 0, failed: 50, issuesFound: 0 });
  assert.equal(a.severity, "critical");
});
```

- [x] **Step B2: Run the test to confirm it fails**

Run: `cd functions; npm run build; node --test test/dealer-sweep-alert.test.js`
Expected: FAIL — module not found.

- [x] **Step B3: Implement the dispatcher + pure builder**

Create `functions/src/services/dealer-sweep-alert.ts` with:
- `buildSweepAlert(summary)` — pure function returning `{ subject, severity, lines }` (severity: `info` if failed===0, `critical` if verified===0 && total>0, else `warning`).
- `dispatchDealerSweepAlert(organizationId, runId, summary)` — looks up org admin emails (follow the pattern used by `services/lender-email.ts`), sends via the existing email transport, never throws, and stamps `dealerAlertSentAt` on the run doc to stay idempotent.

Reference the existing `functions/src/services/lender-email.ts` for transport + recipient lookup conventions.

- [x] **Step B4: Run the test to confirm it passes**

Run: `cd functions; npm run build; node --test test/dealer-sweep-alert.test.js`
Expected: PASS (3/3).

- [x] **Step B5: Call the dispatcher when a run finalizes**

In `functions/src/functions/manual-carrier-sweep.ts`, at the point a run transitions to a terminal state (completed/failed), compute the summary from the run's result counts and call `dispatchDealerSweepAlert(organizationId, runId, summary)` guarded by `if (!run.dealerAlertSentAt)`. Keep it best-effort (`.catch` + log).

- [x] **Step B6: Build and deploy**

Run: `cd functions; npm run build`
Then from repo root: `firebase deploy --only functions:recordManualSweepResult`
(Deploy any other sweep-finalizing function touched, one at a time.)
Expected: deploy succeeds.

- [x] **Step B7: Commit**

```powershell
git add functions/src/services/dealer-sweep-alert.ts functions/test/dealer-sweep-alert.test.js functions/src/functions/manual-carrier-sweep.ts
git commit -m "feat(alerts): email dealer admins on sweep completion/failure"
```

---

## Chunk 2: Partner API hardening (Tasks C, D, E)

### Task C: Rate limiting + payload size cap on partnerDealsApi

**Why:** The public `POST /v1/deals` endpoint has no rate limit and no request-size cap. The `rateLimit` middleware already exists but is not wired in. A buggy or hostile partner could hammer the endpoint or send oversized payloads against a 256MiB function.

**Design:** Apply the existing in-memory `rateLimit` keyed by `keyId`, and reject bodies over a fixed byte cap with `413`/`invalid_request` before processing. Add a `Retry-After` hint on 429.

**Files:**
- Modify: `functions/src/functions/partner-deals-api.ts`
- Create: `functions/test/partner-deals-api-limits.test.js`

- [x] **Step C1: Write the failing test for the payload-size guard**

Create `functions/test/partner-deals-api-limits.test.js` testing a pure exported `assertPayloadWithinLimit(rawBodyLength)` helper:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { assertPayloadWithinLimit, MAX_BODY_BYTES } = require("../lib/functions/partner-deals-api");

test("small payload is allowed", () => {
  assert.doesNotThrow(() => assertPayloadWithinLimit(1024));
});

test("oversized payload is rejected", () => {
  assert.throws(() => assertPayloadWithinLimit(MAX_BODY_BYTES + 1), /too large|payload/i);
});
```

- [x] **Step C2: Run the test to confirm it fails**

Run: `cd functions; npm run build; node --test test/partner-deals-api-limits.test.js`
Expected: FAIL — `assertPayloadWithinLimit` is not exported / module shape differs.

- [x] **Step C3: Implement the guards in partner-deals-api.ts**

In `functions/src/functions/partner-deals-api.ts`:
- Add `export const MAX_BODY_BYTES = 256 * 1024;` (256 KB — generous for a single deal).
- Add `export function assertPayloadWithinLimit(len: number): void { if (len > MAX_BODY_BYTES) throw new HttpsError("invalid-argument", "Request payload too large."); }`.
- In the handler, after `requireApiKey`, before routing the POST:
  - Compute body size: `const rawLen = Buffer.byteLength(req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})));` and call `assertPayloadWithinLimit(rawLen)` (return `413` with `errorBody("invalid_request", …)`).
  - Apply rate limit: `import { rateLimit } from "../middleware/rate-limit";` then `rateLimit(\`partnerApi:${ctx.keyId}\`, { windowMs: 60_000, max: 120 });` Catch the thrown `HttpsError("resource-exhausted")` and respond `429` with `errorBody("rate_limited", message)` plus a `Retry-After: 60` header.

- [x] **Step C4: Run the test to confirm it passes**

Run: `cd functions; npm run build; node --test test/partner-deals-api-limits.test.js`
Expected: PASS (2/2).

- [x] **Step C5: Build and deploy**

Run: `cd functions; npm run build`
Then from repo root: `firebase deploy --only functions:partnerDealsApi`
Expected: deploy succeeds.

- [x] **Step C6: Smoke-test live (optional)**

Run a quick `Invoke-RestMethod` loop against `https://api.autolientracker.com/v1/deals` with a dummy key and confirm a `429` after the limit. (Expect `401` first since the key is invalid — confirm the endpoint still responds with JSON.)

- [x] **Step C7: Commit**

```powershell
git add functions/src/functions/partner-deals-api.ts functions/test/partner-deals-api-limits.test.js
git commit -m "feat(partner-api): rate limit + payload size cap on /v1/deals"
```

---

### Task D: Sandbox / test API keys (`alt_test_`)

**Why:** Only `alt_live_` keys exist, so a partner can only integrate against production data (real borrowers, real SMS). Every credible API offers a test key. This unblocks DMS engineering teams.

**Design:** Add a parallel `alt_test_` prefix. Test keys authenticate identically and reach the same endpoint, but ingestion runs in **dry-run mode**: validate + echo a synthetic `policyId`, persist nothing, fire no SMS/webhook. The key's `mode` (`live`/`test`) is stored on the key doc and surfaced in `ApiKeyContext`.

**Files:**
- Modify: `functions/src/middleware/api-key.ts` (accept both prefixes, return `mode`)
- Create: `functions/test/api-key-mode.test.js`
- Modify: `functions/src/functions/partner-deals-api.ts` (dry-run path when `ctx.mode === "test"`)
- Modify: `functions/src/functions/partner-api-keys.ts` (`issuePartnerApiKey` accepts `mode`)

- [x] **Step D1: Write the failing test for prefix/mode detection**

Create `functions/test/api-key-mode.test.js` testing a pure `keyMode(rawKey)`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { keyMode, isKnownKeyPrefix } = require("../lib/middleware/api-key");

test("live prefix maps to live mode", () => {
  assert.equal(keyMode("alt_live_abc"), "live");
});

test("test prefix maps to test mode", () => {
  assert.equal(keyMode("alt_test_abc"), "test");
});

test("unknown prefix is rejected", () => {
  assert.equal(isKnownKeyPrefix("xyz_abc"), false);
});
```

- [x] **Step D2: Run the test to confirm it fails**

Run: `cd functions; npm run build; node --test test/api-key-mode.test.js`
Expected: FAIL — helpers not exported.

- [x] **Step D3: Implement prefix/mode support in api-key.ts**

In `functions/src/middleware/api-key.ts`:
- Add `export const LIVE_PREFIX = "alt_live_";` and `export const TEST_PREFIX = "alt_test_";` (keep `KEY_PREFIX` as alias of live for back-compat).
- `export function isKnownKeyPrefix(raw: string): boolean` — true if it starts with either prefix.
- `export function keyMode(raw: string): "live" | "test"` — `test` if it starts with `alt_test_`, else `live`.
- `generateApiKey(mode)` — mint with the matching prefix.
- In `requireApiKey`, replace the single-prefix check with `isKnownKeyPrefix`, and add `mode: keyMode(rawKey)` to the returned `ApiKeyContext`. Persist/read `mode` on the key doc.
- Extend `ApiKeyContext` with `mode: "live" | "test"`.

- [x] **Step D4: Run the test to confirm it passes**

Run: `cd functions; npm run build; node --test test/api-key-mode.test.js`
Expected: PASS (3/3).

- [x] **Step D5: Add the dry-run path to partnerDealsApi**

In `handlePostDeal`, when `ctx.mode === "test"`:
- Run `validateDealIngestInput(input)` (so partners still get real validation errors).
- Skip `ingestDeal`; return `201` with a synthetic response: `{ policyId: "test_" + <random>, borrowerId: "test_…", vehicleId: "test_…", isNewBorrower: true, intakeRequested: false, mode: "test" }`.
- Do NOT write idempotency docs, do NOT dispatch webhooks.

For `GET /v1/deals/{policyId}` with a test key, return a synthetic ACTIVE/GREEN sample when `policyId` starts with `test_`.

- [x] **Step D6: Let issuePartnerApiKey mint test keys**

In `functions/src/functions/partner-api-keys.ts`, accept an optional `mode: "live" | "test"` (default `live`) on `issuePartnerApiKey`, pass it to `generateApiKey(mode)`, and store `mode` on the key doc. Keep `requireSuperAdmin`.

- [x] **Step D7: Build and deploy (one at a time)**

Run: `cd functions; npm run build`
Then from repo root, deploy each touched function separately:
`firebase deploy --only functions:partnerDealsApi`
`firebase deploy --only functions:issuePartnerApiKey`
Expected: both succeed.

- [x] **Step D8: Update partner docs**

Add a short "Test mode" note to `docs/partner-api/integration-guide.md` explaining `alt_test_` keys (validate-only, no side effects). Keep it brief.

- [x] **Step D9: Commit**

```powershell
git add functions/src/middleware/api-key.ts functions/test/api-key-mode.test.js functions/src/functions/partner-deals-api.ts functions/src/functions/partner-api-keys.ts docs/partner-api/integration-guide.md
git commit -m "feat(partner-api): add alt_test_ sandbox keys with dry-run ingestion"
```

---

### Task E: Webhook retries + partner-visible delivery status

**Why:** Webhooks are single fire-and-forget. If the partner endpoint blips, the event is logged but never retried, and the partner cannot see/replay deliveries. Real integrations need retries + visibility.

**Design:** Add bounded retry with exponential backoff (3 attempts: immediate, +2s, +8s) inside `dispatchStatusWebhook`, treating non-2xx and network errors as retryable. Record each attempt count and final outcome on the existing `webhookDeliveries` doc. Add a read endpoint `GET /v1/webhooks/deliveries` (last 50, org-scoped) so partners can inspect delivery history.

**Files:**
- Modify: `functions/src/services/outbound-webhook.ts` (retry loop + attempt metadata)
- Create: `functions/test/outbound-webhook-retry.test.js`
- Modify: `functions/src/functions/partner-deals-api.ts` (route `GET /v1/webhooks/deliveries`)

- [x] **Step E1: Write the failing test for retry/backoff decision**

Create `functions/test/outbound-webhook-retry.test.js` testing a pure `shouldRetry(status, attempt, maxAttempts)` + `backoffMs(attempt)`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldRetry, backoffMs, MAX_WEBHOOK_ATTEMPTS } = require("../lib/services/outbound-webhook");

test("2xx never retries", () => {
  assert.equal(shouldRetry(200, 1, MAX_WEBHOOK_ATTEMPTS), false);
});

test("5xx retries until max attempts", () => {
  assert.equal(shouldRetry(503, 1, MAX_WEBHOOK_ATTEMPTS), true);
  assert.equal(shouldRetry(503, MAX_WEBHOOK_ATTEMPTS, MAX_WEBHOOK_ATTEMPTS), false);
});

test("backoff grows with attempt", () => {
  assert.ok(backoffMs(2) > backoffMs(1));
});
```

- [x] **Step E2: Run the test to confirm it fails**

Run: `cd functions; npm run build; node --test test/outbound-webhook-retry.test.js`
Expected: FAIL — helpers not exported.

- [x] **Step E3: Implement retry helpers + loop**

In `functions/src/services/outbound-webhook.ts`:
- `export const MAX_WEBHOOK_ATTEMPTS = 3;`
- `export function shouldRetry(status, attempt, max)` — false on 2xx, false when `attempt >= max`, true otherwise (and for network errors, model as status `0`).
- `export function backoffMs(attempt)` — `[0, 2000, 8000][attempt - 1] ?? 8000`.
- Wrap the single fetch in a loop up to `MAX_WEBHOOK_ATTEMPTS`, awaiting `backoffMs` between attempts (use a small `sleep` helper). Keep the overall function non-throwing.
- Record `attempts`, `finalStatus`, and `lastError` on the `webhookDeliveries` doc.

- [x] **Step E4: Run the test to confirm it passes**

Run: `cd functions; npm run build; node --test test/outbound-webhook-retry.test.js`
Expected: PASS (3/3).

- [x] **Step E5: Add GET /v1/webhooks/deliveries to the partner API**

In `functions/src/functions/partner-deals-api.ts`:
- Add a route match for `GET /v1/webhooks/deliveries`.
- Query `webhookDeliveries` where `organizationId === ctx.organizationId`, order by `createdAt` desc, limit 50.
- Return `{ deliveries: [{ policyId, event, finalStatus, attempts, createdAt, lastError }] }` (timestamps as ISO).
- Ensure tenant isolation (never return another org's deliveries).

- [x] **Step E6: Build and deploy**

Run: `cd functions; npm run build`
Then from repo root: `firebase deploy --only functions:partnerDealsApi`
Expected: deploy succeeds. (The webhook service is bundled with whatever functions import it — redeploy `recordManualSweepResult` too if it dispatches webhooks.)

- [x] **Step E7: Commit**

```powershell
git add functions/src/services/outbound-webhook.ts functions/test/outbound-webhook-retry.test.js functions/src/functions/partner-deals-api.ts
git commit -m "feat(webhooks): retry with backoff + GET /v1/webhooks/deliveries"
```

---

## Chunk 3: Honesty in scope (Task F)

### Task F: "Coverage-only" labeling for unsupported carriers

**Why:** Only State Farm and Progressive have real verification adapters. Other carriers (Allstate, GEICO, Nationwide, National General) get expiry reminders only — coverage changes are never detected. The UI must not imply full verification for these, or a dealer could be blindsided after a loss.

**Design:** Expose a per-policy/per-state `verificationScope` (`full` vs `coverage_only`) derived from `ADAPTER_READY_CARRIERS`, surface it in the org status callable, and render a clear "Coverage-only" label + tooltip in the dashboard.

**Files:**
- Modify: `functions/src/services/verification-eligibility.ts` (export `getVerificationScope(carrier)`)
- Create: `functions/test/verification-scope.test.js`
- Modify: `functions/src/functions/get-org-verification-status.ts` (add `coverageOnlyCount`)
- Modify: dashboard policy row/grid (frontend) — add "Coverage-only" badge + tooltip

- [ ] **Step F1: Write the failing test**

Create `functions/test/verification-scope.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { getVerificationScope } = require("../lib/services/verification-eligibility");

test("supported carrier is full verification", () => {
  assert.equal(getVerificationScope("state_farm"), "full");
  assert.equal(getVerificationScope("progressive"), "full");
});

test("unsupported carrier is coverage_only", () => {
  assert.equal(getVerificationScope("geico"), "coverage_only");
  assert.equal(getVerificationScope("allstate"), "coverage_only");
});
```

- [ ] **Step F2: Run the test to confirm it fails**

Run: `cd functions; npm run build; node --test test/verification-scope.test.js`
Expected: FAIL — `getVerificationScope` not exported.

- [ ] **Step F3: Implement getVerificationScope**

In `functions/src/services/verification-eligibility.ts`, add:

```ts
export type VerificationScope = "full" | "coverage_only";

export function getVerificationScope(carrier: string | undefined): VerificationScope {
  const normalized = normalizeCarrier(carrier);
  return ADAPTER_READY_CARRIERS.includes(normalized as never) ? "full" : "coverage_only";
}
```

- [ ] **Step F4: Run the test to confirm it passes**

Run: `cd functions; npm run build; node --test test/verification-scope.test.js`
Expected: PASS (2/2).

- [ ] **Step F5: Surface coverageOnlyCount in the org status callable**

In `functions/src/functions/get-org-verification-status.ts`, while iterating policies, count those whose carrier is `coverage_only` and add `coverageOnlyCount: number` to the response interface + object.

- [ ] **Step F6: Build and deploy**

Run: `cd functions; npm run build`
Then from repo root: `firebase deploy --only functions:getOrgVerificationStatus`
Expected: deploy succeeds.

- [ ] **Step F7: Add the dashboard "Coverage-only" badge**

On the portfolio grid / policy row, render a "Coverage-only" badge with a tooltip ("Expiry is monitored; coverage changes are not actively verified for this carrier.") for coverage-only policies. Follow existing badge styling.

- [ ] **Step F8: Verify the frontend builds**

Run: `cd frontend; npm run build`
Expected: build succeeds.

- [ ] **Step F9: Commit**

```powershell
git add functions/src/services/verification-eligibility.ts functions/test/verification-scope.test.js functions/src/functions/get-org-verification-status.ts frontend/src
git commit -m "feat(verification): label coverage-only carriers in dashboard"
```

---

## Backlog (post-demo — NOT scheduled here)

Build only after the demo validates interest. Each deserves its own plan:

- **Self-serve partner key portal** — org-admin UI to issue/rotate/revoke keys and configure webhooks without super-admin.
- **OAuth "Connect AutoLien" flow** — let a dealer authorize a DMS to push their deals with one click (the multiplier for the Frazer relationship).
- **Audit-grade verification trail** — `logAudit()` on every status change with `{who, when, before, after, verifiedVia}`, screenshot hashing/custody, and an exportable per-org verification report (PDF/CSV) for regulators/lawyers.
- **Operator crash recovery** — detect partial/incomplete runs, retry skipped policies, flag "incomplete sweep" instead of silently finalizing.
- **Forced re-verification SLA** — escalate after N consecutive missed/failed verifications instead of silently keeping the last snapshot.
- **More carrier adapters** — expand `ADAPTER_READY_CARRIERS` (GEICO, Allstate, Nationwide, National General) to shrink the coverage-only set.
- **Lienholder false-positive override** — let a dealer mark "lienholder verified" + note when OCR name-matching misfires.
- **API versioning/deprecation policy** — documented path to v2 with sunset windows.
- **CORS hardening** — explicit allowed-origins config on `partnerDealsApi`.

---

## Execution Handoff

Build **one task at a time, in order (A → F)**, pausing after each task's commit for review before starting the next. Do not start a task until the previous one is committed and (where applicable) deployed and verified.
