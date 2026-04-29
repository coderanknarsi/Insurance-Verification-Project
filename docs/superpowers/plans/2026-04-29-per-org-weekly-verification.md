# Per-Org Weekly Carrier Verification — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each dealership gets one fixed weekday Mon–Fri at 7am CT when its entire eligible portfolio is verified against carrier portals, replacing the current Sunday-2am all-orgs sweep. Borrowers without uploaded insurance stay in intake-chase. Carriers we can't scrape get a heavier reminder cadence.

**Architecture:** A single `verification-eligibility` helper classifies every policy into one of four states (`PENDING_UPLOAD`, `INSURED_SUPPORTED`, `INSURED_UNSUPPORTED`, `INSURED_NO_CREDS`). The dispatcher cron expands from once-weekly to Mon–Fri, filters orgs by their assigned `verificationDayOfWeek`, and only batches `INSURED_SUPPORTED` policies to the engine. The expiry-reminder cron branches on the same eligibility helper to apply a bumped cadence for the unverifiable buckets. A new `onOrgOnboardingComplete` callable bulk-fires intake links for `PENDING_UPLOAD` borrowers when a dealer onboards. An admin-only `simulateVerificationSweep` callable enables on-demand QA. Frontend surfaces the new state via per-borrower badges, an org-level header strip, and collapsible weekly-run rows in the Verifications tab.

**Tech Stack:** TypeScript, Firebase Functions v2 (onSchedule + onCall), Firestore, Next.js 16 frontend, existing Cloud Run engine (`/verify`), node:test for unit tests.

**Spec:** [docs/superpowers/specs/2026-04-29-per-org-weekly-verification-design.md](../specs/2026-04-29-per-org-weekly-verification-design.md)

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `functions/src/services/verification-eligibility.ts` | Create | Pure function: `getPolicyVerificationState(policy, org, hasCreds) → State` + `getOrgVerificationDay(orgId, override?) → 1..5` |
| `functions/src/services/verification-eligibility.test.ts` | Create | Unit tests for the eligibility helper (pure, no Firestore) |
| `functions/src/types/organization.ts` | Modify | Add `verificationDayOfWeek?: 1\|2\|3\|4\|5` to `OrganizationSettings` |
| `functions/src/functions/data-feed-dispatcher.ts` | Modify | Cron schedule → `0 7 * * 1-5`; per-org day filter; eligibility filter; bucket counts in run record |
| `functions/src/functions/daily-expiry-reminder.ts` | Modify | Branch on eligibility → standard vs bumped cadence |
| `functions/src/services/expiry-cadence.ts` | Create | Pure function: `shouldRemindAt(daysUntilExpiry, cadenceMode) → boolean` |
| `functions/src/services/expiry-cadence.test.ts` | Create | Unit tests for the cadence helper |
| `functions/src/functions/onboarding-kickoff.ts` | Create | New `onOrgOnboardingComplete` callable: bulk-fire intake links, throttled, quiet-hours-aware |
| `functions/src/functions/simulate-verification-sweep.ts` | Create | Admin-only callable: trigger a sweep for one org on demand |
| `functions/src/index.ts` | Modify | Export the two new callables |
| `frontend/src/lib/api.ts` | Modify | Add types + client wrappers for the two new callables; add `verificationState` to `BorrowerWithVehicles` |
| `frontend/src/components/borrower-verification-badge.tsx` | Create | New component: 4 visual states |
| `frontend/src/components/borrower-table.tsx` | Modify | Render the badge in the row |
| `frontend/src/components/dashboard-header-strip.tsx` | Create | Last/next sweep + in-scope count |
| `frontend/src/app/page.tsx` | Modify | Render the header strip above the borrower table |
| `frontend/src/components/verifications-tab.tsx` | Modify | Group notifications by `runId` into collapsible weekly-run rows |
| `frontend/src/components/organization-profile-form.tsx` | Modify | Add weekday selector + read-only "your verification day" display |
| `frontend/src/components/onboarding-wizard.tsx` | Modify | Call `onOrgOnboardingComplete` on final step |

---

## Chunk 1: Eligibility Helper (Foundation, No Behavior Change)

This chunk introduces the single source of truth for "what should happen to this policy" and the org's verification day. Nothing else changes. After this chunk the codebase compiles, deploys cleanly, and the helper is unit-tested.

### Task 1.1: Add `verificationDayOfWeek` to OrganizationSettings type

**Files:**
- Modify: `functions/src/types/organization.ts`

- [ ] **Step 1: Add the field**

In [`functions/src/types/organization.ts`](../../../functions/src/types/organization.ts) inside `OrganizationSettings`, add:

```typescript
export interface OrganizationSettings {
  notificationPreference: NotificationPreference;
  lapseGracePeriodDays: number;
  expirationWarningDays: number;
  complianceRules?: ComplianceRules;
  lienholderName?: string;
  /**
   * Day of week (1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri) when this org's
   * portfolio is verified against carrier portals. When unset, derived
   * from a stable hash of the org id. Admins can override via Settings.
   */
  verificationDayOfWeek?: 1 | 2 | 3 | 4 | 5;
}
```

- [ ] **Step 2: Compile**

Run: `cd functions; npm run build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/types/organization.ts
git commit -m "types: add verificationDayOfWeek to OrganizationSettings"
```

### Task 1.2: Create the eligibility helper with tests

**Files:**
- Create: `functions/src/services/verification-eligibility.ts`
- Create: `functions/src/services/verification-eligibility.test.ts`

- [ ] **Step 1: Confirm node:test is available**

Run: `cd functions; node --test --version 2>&1 | head -1` — confirm node ≥18.
If `package.json` lacks a `test` script, add one in Step 5.

- [ ] **Step 2: Write the failing tests first**

Create `functions/src/services/verification-eligibility.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getOrgVerificationDay,
  getPolicyVerificationState,
  SUPPORTED_CARRIERS,
  VerificationState,
} from "./verification-eligibility";

describe("getOrgVerificationDay", () => {
  it("returns 1..5 for any orgId", () => {
    for (const id of ["a", "frazer-motors", "abc123", "demo-org", "x"]) {
      const day = getOrgVerificationDay(id);
      assert.ok(day >= 1 && day <= 5, `day for ${id} was ${day}`);
    }
  });

  it("is deterministic for the same id", () => {
    assert.equal(getOrgVerificationDay("frazer"), getOrgVerificationDay("frazer"));
  });

  it("respects an explicit override", () => {
    assert.equal(getOrgVerificationDay("anything", 3), 3);
  });

  it("ignores invalid overrides and falls back to hash", () => {
    const hash = getOrgVerificationDay("anything");
    assert.equal(getOrgVerificationDay("anything", 0 as unknown as 1), hash);
    assert.equal(getOrgVerificationDay("anything", 7 as unknown as 1), hash);
  });
});

describe("getPolicyVerificationState", () => {
  const baseOrgId = "org-1";
  const supportedCarrier = SUPPORTED_CARRIERS[0];

  it("returns PENDING_UPLOAD when no insuranceProvider is set", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: undefined, status: "UNVERIFIED" } as never,
      baseOrgId,
      new Set(),
    );
    assert.equal(state, VerificationState.PENDING_UPLOAD);
  });

  it("returns INSURED_UNSUPPORTED for non-supported carriers", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: "GEICO", status: "ACTIVE" } as never,
      baseOrgId,
      new Set([supportedCarrier]),
    );
    assert.equal(state, VerificationState.INSURED_UNSUPPORTED);
  });

  it("returns INSURED_NO_CREDS when supported but creds missing", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: supportedCarrier, status: "ACTIVE" } as never,
      baseOrgId,
      new Set(),
    );
    assert.equal(state, VerificationState.INSURED_NO_CREDS);
  });

  it("returns INSURED_SUPPORTED when supported + creds present + active", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: supportedCarrier, status: "ACTIVE" } as never,
      baseOrgId,
      new Set([supportedCarrier]),
    );
    assert.equal(state, VerificationState.INSURED_SUPPORTED);
  });

  it("returns INSURED_NO_CREDS for cancelled supported policies (no sweep)", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: supportedCarrier, status: "CANCELLED" } as never,
      baseOrgId,
      new Set([supportedCarrier]),
    );
    // Cancelled policies are not eligible for the sweep — they're handled by
    // the lapse cadence. Treat as "not in sweep" by returning a non-supported state.
    assert.notEqual(state, VerificationState.INSURED_SUPPORTED);
  });

  it("normalizes carrier names case-insensitively", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: "PROGRESSIVE", status: "ACTIVE" } as never,
      baseOrgId,
      new Set(["progressive"]),
    );
    assert.equal(state, VerificationState.INSURED_SUPPORTED);
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd functions; npx tsc --noEmit && node --test --import tsx ./src/services/verification-eligibility.test.ts`

Expected: tests fail because `verification-eligibility.ts` doesn't exist yet.

If `tsx` is not installed: `cd functions; npm install --save-dev tsx`. If it's already a dependency, skip.

- [ ] **Step 4: Implement the helper**

Create `functions/src/services/verification-eligibility.ts`:

```typescript
import { createHash } from "crypto";
import { PolicyStatus } from "../types/policy";
import type { Policy } from "../types/policy";

/**
 * Carriers the engine can verify automatically. Source of truth — must
 * match the IDs registered in `engine/src/carriers/registry.ts`.
 */
export const SUPPORTED_CARRIERS = [
  "progressive",
  "allstate",
  "state_farm",
  "national_general",
] as const;

export type SupportedCarrier = (typeof SUPPORTED_CARRIERS)[number];

/** Lifecycle state that drives which workflow operates on a policy. */
export enum VerificationState {
  /** No insurance card uploaded yet — intake-chase is active. */
  PENDING_UPLOAD = "PENDING_UPLOAD",
  /** Card uploaded, carrier supported, org has master creds — eligible for sweep. */
  INSURED_SUPPORTED = "INSURED_SUPPORTED",
  /** Card uploaded, carrier outside supported set — bumped reminders only. */
  INSURED_UNSUPPORTED = "INSURED_UNSUPPORTED",
  /** Card uploaded, carrier supported, but org has no master creds — bumped reminders + dealer nudge. */
  INSURED_NO_CREDS = "INSURED_NO_CREDS",
}

/** Statuses that make a policy eligible for the weekly engine sweep. */
const SWEEP_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set<string>([
  PolicyStatus.ACTIVE,
  // EXPIRING_SOON is a compliance issue, not a status. ACTIVE policies whose
  // coveragePeriod.endDate is near term still classify as ACTIVE here and
  // remain in the sweep — the carrier will tell us if they're truly expired.
]);

/** Normalize a free-text carrier name to a registry id. */
export function normalizeCarrier(name: string | undefined): string {
  if (!name) return "";
  return name.toLowerCase().trim().replace(/\s+/g, "_");
}

/**
 * Decide which lifecycle state applies to a single policy.
 *
 * @param policy The policy document data.
 * @param orgId Org id (reserved for future per-org carrier overrides).
 * @param orgActiveCarrierCreds Set of carrier ids the org has active master creds for.
 */
export function getPolicyVerificationState(
  policy: Pick<Policy, "insuranceProvider" | "status">,
  orgId: string,
  orgActiveCarrierCreds: ReadonlySet<string>,
): VerificationState {
  void orgId; // reserved
  const carrier = normalizeCarrier(policy.insuranceProvider);
  if (!carrier) return VerificationState.PENDING_UPLOAD;

  const isSupported = (SUPPORTED_CARRIERS as readonly string[]).includes(carrier);
  if (!isSupported) return VerificationState.INSURED_UNSUPPORTED;

  if (!orgActiveCarrierCreds.has(carrier)) return VerificationState.INSURED_NO_CREDS;

  if (!SWEEP_ELIGIBLE_STATUSES.has(String(policy.status))) {
    // Supported + creds present but cancelled/expired/etc. — not in sweep,
    // lapse cadence handles it. We surface NO_CREDS so reminders bump up.
    return VerificationState.INSURED_NO_CREDS;
  }

  return VerificationState.INSURED_SUPPORTED;
}

/**
 * Returns the assigned verification weekday for an org (1=Mon … 5=Fri).
 * If `override` is a valid 1..5 it wins; otherwise stable hash of orgId.
 */
export function getOrgVerificationDay(
  orgId: string,
  override?: 1 | 2 | 3 | 4 | 5,
): 1 | 2 | 3 | 4 | 5 {
  if (override && override >= 1 && override <= 5) return override;
  const hash = createHash("sha256").update(orgId).digest();
  const n = (hash.readUInt32BE(0) % 5) + 1;
  return n as 1 | 2 | 3 | 4 | 5;
}
```

- [ ] **Step 5: Add a test script to functions/package.json if missing**

Open `functions/package.json`. If there's no `test` script, add:

```json
"scripts": {
  "test": "tsc --noEmit && node --test --import tsx ./src/**/*.test.ts"
}
```

If a `test` script already exists, do not overwrite it.

- [ ] **Step 6: Run tests — expect pass**

Run: `cd functions; npm test`
Expected: All tests in `verification-eligibility.test.ts` pass.

- [ ] **Step 7: Commit**

```bash
git add functions/src/services/verification-eligibility.ts functions/src/services/verification-eligibility.test.ts functions/package.json
git commit -m "feat(eligibility): add verification state + per-org weekday helper"
```

---

## Chunk 2: Dispatcher Rewrite

This chunk swaps the cron schedule and adds the per-org day filter and eligibility filter to the existing `weeklyDataFeedDispatcher`. After this chunk, sweeps fire Mon–Fri at 7am CT for the orgs assigned to that day, and only `INSURED_SUPPORTED` policies are sent to the engine.

### Task 2.1: Update the dispatcher to use eligibility + per-org day

**Files:**
- Modify: `functions/src/functions/data-feed-dispatcher.ts`

- [ ] **Step 1: Read the existing dispatcher**

Read [`functions/src/functions/data-feed-dispatcher.ts`](../../../functions/src/functions/data-feed-dispatcher.ts) end-to-end so you understand the current loop shape (org → policies → carrier buckets → engine POST).

- [ ] **Step 2: Change cron schedule and rename**

Replace the `onSchedule` config block:

```typescript
export const weeklyDataFeedDispatcher = onSchedule(
  {
    schedule: "0 7 * * 1-5",          // 7:00 AM CT Mon–Fri
    timeZone: "America/Chicago",
    retryCount: 1,
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    // ...
  }
);
```

Keep the export name `weeklyDataFeedDispatcher` (renaming would force a Firebase function migration; not worth it).

- [ ] **Step 3: Add today-weekday computation at the top of the handler**

Right after `const runId = ...; const runStart = ...;`, add:

```typescript
import { getOrgVerificationDay, getPolicyVerificationState, normalizeCarrier, VerificationState } from "../services/verification-eligibility";

// Inside the handler, after runId/runStart:
const todayWeekday = (() => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  });
  const map: Record<string, 1 | 2 | 3 | 4 | 5> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5,
  };
  return map[fmt.format(new Date())];
})();

if (!todayWeekday) {
  logger.info("[data-feed] Not a weekday — skipping");
  return;
}
```

- [ ] **Step 4: Add per-org day filter**

Inside the org loop, immediately after `if (orgDoc.id === DEMO_ORG_ID) continue;`, add:

```typescript
const assignedDay = getOrgVerificationDay(
  orgDoc.id,
  orgDoc.data().settings?.verificationDayOfWeek,
);
if (assignedDay !== todayWeekday) continue;
```

- [ ] **Step 5: Add eligibility filter inside policy loop**

Replace the existing carrier-bucket loop body. The current code groups by `carrier` then includes `if (!carrier || !activeCarriers.has(carrier)) continue;`. Add bucket counters and use the helper:

```typescript
// Counters for the run record
const buckets = {
  pendingUpload: 0,
  insuredSupported: 0,
  insuredUnsupported: 0,
  insuredNoCreds: 0,
};

const carrierBuckets = new Map<string, Array<...>>(); // existing shape

for (const policyDoc of policiesSnap.docs) {
  const p = policyDoc.data();
  const state = getPolicyVerificationState(
    p as never,
    orgDoc.id,
    activeCarriers,
  );

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

  const carrier = normalizeCarrier(p.insuranceProvider ?? "");
  if (!carrierBuckets.has(carrier)) carrierBuckets.set(carrier, []);
  carrierBuckets.get(carrier)!.push({
    policyId: policyDoc.id,
    vehicleId: p.vehicleId,
    borrowerId: p.borrowerId,
    policyNumber: p.policyNumber,
    insuranceProvider: p.insuranceProvider ?? carrier,
  });
}

logger.info(`[data-feed] Org ${orgDoc.id} buckets`, buckets);
```

- [ ] **Step 6: Persist bucket counts to the run record**

Update the final `runRef.update({ ... })` call to include a per-org breakdown. Easiest: accumulate `bucketsByOrg: Record<string, typeof buckets>` outside the loop and write it.

- [ ] **Step 7: Compile**

Run: `cd functions; npm run build`
Expected: No TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add functions/src/functions/data-feed-dispatcher.ts
git commit -m "feat(dispatcher): per-org weekday + eligibility filter, Mon-Fri 7am CT"
```

### Task 2.2: Add the admin sweep simulator

**Files:**
- Create: `functions/src/functions/simulate-verification-sweep.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Create the callable**

Create `functions/src/functions/simulate-verification-sweep.ts`:

```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { GoogleAuth } from "google-auth-library";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { requireAuth, requireRole } from "../middleware/auth";
import { UserRole } from "../types/user";
import {
  getPolicyVerificationState,
  normalizeCarrier,
  VerificationState,
} from "../services/verification-eligibility";
import type { VerificationBatch, VerificationInput } from "./data-feed-types";

const ENGINE_URL = process.env.DATA_FEED_ENGINE_URL ?? "";

/**
 * Admin-only: trigger a verification sweep for one org on demand.
 * Bypasses the day-of-week filter — useful for QA, demos, and
 * remediation when a scheduled sweep failed.
 */
export const simulateVerificationSweep = onCall(async (request) => {
  const auth = requireAuth(request);
  await requireRole(auth.uid, UserRole.ADMIN);

  const orgId = String(request.data?.orgId ?? "");
  if (!orgId) throw new HttpsError("invalid-argument", "orgId required");
  if (!ENGINE_URL) throw new HttpsError("failed-precondition", "engine URL not configured");

  const runId = `sim_${Date.now()}_${orgId}`;
  logger.info(`[simulate] Starting ${runId}`);

  // Same logic as data-feed-dispatcher but for one org.
  // Extract the per-org body from the dispatcher into a shared function
  // (`runSweepForOrg(orgId, runId)`) and call it from both places.
  // ... (implementation mirrors the org-loop body in data-feed-dispatcher) ...

  return { runId, ok: true };
});
```

- [ ] **Step 2: Refactor dispatcher to extract `runSweepForOrg`**

In `data-feed-dispatcher.ts`, extract the inner per-org body (carrier bucketing + engine POST) into an exported helper:

```typescript
export async function runSweepForOrg(
  orgId: string,
  runId: string,
): Promise<OrgSweepResult> {
  // ... existing per-org logic ...
  return { batches, policies, success, errors, buckets };
}
```

The cron handler iterates orgs and calls `runSweepForOrg`. The simulator calls it directly with no day filter.

- [ ] **Step 3: Wire the simulator export**

In [`functions/src/index.ts`](../../../functions/src/index.ts), add:

```typescript
export { simulateVerificationSweep } from "./functions/simulate-verification-sweep";
```

- [ ] **Step 4: Compile**

Run: `cd functions; npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add functions/src/functions/simulate-verification-sweep.ts functions/src/functions/data-feed-dispatcher.ts functions/src/index.ts
git commit -m "feat(simulator): admin callable to trigger sweep on demand"
```

### Task 2.3: Manual integration test

- [ ] **Step 1: Deploy functions**

Run: `firebase deploy --only functions:weeklyDataFeedDispatcher,functions:simulateVerificationSweep --non-interactive`

- [ ] **Step 2: Pick a test org**

Use a non-demo org with at least one Progressive policy and saved master creds for Progressive. If none exists, save creds via the existing UI first.

- [ ] **Step 3: Invoke simulator**

From the admin dashboard (or via `firebase functions:shell`), call `simulateVerificationSweep({ orgId: "<id>" })`.

- [ ] **Step 4: Verify run record**

Check Firestore `dataFeedRuns/<runId>`. Expected: `status: completed`, `bucketsByOrg.<orgId>` populated, `successCount` ≥ 1.

- [ ] **Step 5: Verify engine was called**

Check Cloud Run logs for the engine service. Expected: one `/verify` POST per supported carrier in the org.

- [ ] **Step 6: Verify dashboard**

Open the org's dashboard. Expected: at least one policy shows updated `lastVerifiedAt`.

If any of these fail, fix before proceeding to Chunk 3.

---

## Chunk 3: Bumped Expiry-Reminder Cadence

This chunk extends `dailyExpiryReminder` so that policies in `INSURED_UNSUPPORTED` or `INSURED_NO_CREDS` get the bumped cadence (30/14/7/3/1/day-of) instead of the standard cadence.

### Task 3.1: Pure cadence helper with tests

**Files:**
- Create: `functions/src/services/expiry-cadence.ts`
- Create: `functions/src/services/expiry-cadence.test.ts`

- [ ] **Step 1: Write failing tests**

Create `functions/src/services/expiry-cadence.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldRemindAt, CadenceMode } from "./expiry-cadence";

describe("shouldRemindAt", () => {
  it("standard cadence fires at 7 and 1 days only (default org rule)", () => {
    const days = [30, 14, 10, 7, 5, 3, 1, 0];
    const fired = days.filter((d) => shouldRemindAt(d, CadenceMode.STANDARD, [7, 1]));
    assert.deepEqual(fired, [7, 1]);
  });

  it("bumped cadence fires at 30, 14, 7, 3, 1, 0", () => {
    const days = [31, 30, 20, 14, 10, 7, 5, 3, 2, 1, 0, -1];
    const fired = days.filter((d) => shouldRemindAt(d, CadenceMode.BUMPED, [7, 1]));
    assert.deepEqual(fired, [30, 14, 7, 3, 1, 0]);
  });

  it("standard respects custom org rule", () => {
    assert.equal(shouldRemindAt(14, CadenceMode.STANDARD, [14]), true);
    assert.equal(shouldRemindAt(7, CadenceMode.STANDARD, [14]), false);
  });

  it("bumped ignores org rule entirely", () => {
    assert.equal(shouldRemindAt(30, CadenceMode.BUMPED, [7]), true);
    assert.equal(shouldRemindAt(7, CadenceMode.BUMPED, [7]), true);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd functions; npm test`
Expected: failures because the module doesn't exist.

- [ ] **Step 3: Implement**

Create `functions/src/services/expiry-cadence.ts`:

```typescript
export enum CadenceMode {
  /** Org-configured `reminderDaysBeforeExpiry` (e.g., [7, 1]). */
  STANDARD = "STANDARD",
  /** Fixed schedule for policies the engine cannot verify. */
  BUMPED = "BUMPED",
}

const BUMPED_DAYS: ReadonlySet<number> = new Set([30, 14, 7, 3, 1, 0]);

/**
 * Returns true if a reminder should fire today given the days remaining
 * until expiry and the cadence mode.
 *
 * Standard: matches org's `reminderDaysBeforeExpiry` array exactly.
 * Bumped: fixed 30/14/7/3/1/day-of schedule, ignores org rule.
 */
export function shouldRemindAt(
  daysUntilExpiry: number,
  mode: CadenceMode,
  orgReminderDays: readonly number[],
): boolean {
  if (mode === CadenceMode.BUMPED) return BUMPED_DAYS.has(daysUntilExpiry);
  return orgReminderDays.includes(daysUntilExpiry);
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd functions; npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/expiry-cadence.ts functions/src/services/expiry-cadence.test.ts
git commit -m "feat(cadence): pure helper for standard vs bumped expiry reminders"
```

### Task 3.2: Wire bumped cadence into `dailyExpiryReminder`

**Files:**
- Modify: `functions/src/functions/daily-expiry-reminder.ts`

- [ ] **Step 1: Read the existing function**

Read [`functions/src/functions/daily-expiry-reminder.ts`](../../../functions/src/functions/daily-expiry-reminder.ts) to locate the inner per-policy block where it currently checks `reminderDaysBeforeExpiry`.

- [ ] **Step 2: Pre-load org carrier creds once per org**

At the top of the per-org loop body, fetch the org's active carrier creds (same query as in the dispatcher) and build the `Set<string>`. This lets the eligibility helper run cheaply per policy.

- [ ] **Step 3: Branch on eligibility**

Replace the current "should we send today" check with:

```typescript
import { getPolicyVerificationState, VerificationState } from "../services/verification-eligibility";
import { shouldRemindAt, CadenceMode } from "../services/expiry-cadence";

// per policy:
const state = getPolicyVerificationState(policy, orgDoc.id, activeCarriers);
const mode =
  state === VerificationState.INSURED_UNSUPPORTED || state === VerificationState.INSURED_NO_CREDS
    ? CadenceMode.BUMPED
    : CadenceMode.STANDARD;

if (!shouldRemindAt(daysUntilExpiry, mode, rules.reminderDaysBeforeExpiry ?? [7, 1])) continue;

// existing send logic
```

PENDING_UPLOAD policies are skipped here entirely — intake-chase already handles them.

- [ ] **Step 4: Add a "dealer alert" branch for day-of bumped**

When `mode === BUMPED && daysUntilExpiry === 0`, after sending the borrower reminder, send a separate dealer alert email (reuse `getLenderAlertEmail` pattern from `borrower-intake.ts`). Subject: *"Insurance verification unavailable — coverage expires today for <borrower>"*. Body lists policy + borrower + last known carrier.

- [ ] **Step 5: Compile**

Run: `cd functions; npm run build`
Expected: No errors.

- [ ] **Step 6: Manual test**

Backdate one policy's `coveragePeriod.endDate` to 14 days from today and set `insuranceProvider` to `"GEICO"` (unsupported). Trigger `dailyExpiryReminder` from Cloud Scheduler. Expected: reminder fires (would not fire under the previous standard cadence with default `[7, 1]`).

- [ ] **Step 7: Commit**

```bash
git add functions/src/functions/daily-expiry-reminder.ts
git commit -m "feat(reminders): bumped cadence for unverifiable policies"
```

---

## Chunk 4: Onboarding Kickoff

A new callable bulk-fires intake links to all `PENDING_UPLOAD` borrowers when an org completes onboarding (or finishes a bulk import). Throttled, quiet-hours-aware, idempotent.

### Task 4.1: Build the kickoff callable

**Files:**
- Create: `functions/src/functions/onboarding-kickoff.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Create the callable**

Create `functions/src/functions/onboarding-kickoff.ts`:

```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireOrg } from "../middleware/auth";
import { isWithinSendingHours } from "../services/telnyx";
import { getPolicyVerificationState, VerificationState } from "../services/verification-eligibility";

/**
 * Fire intake links to every PENDING_UPLOAD borrower in an org.
 * Idempotent within 24h: borrowers who received an intake link in the last
 * day are skipped. Outside quiet hours, links queue for next morning by
 * recording a `kickoffPendingAt` timestamp on the org.
 */
export const onOrgOnboardingComplete = onCall(async (request) => {
  const auth = requireAuth(request);
  const orgId = await requireOrg(auth.uid);

  const orgDoc = await collections.organizations.doc(orgId).get();
  const org = orgDoc.data();
  if (!org) throw new HttpsError("not-found", "org missing");

  const tz = org.settings?.complianceRules?.timezone;
  if (!isWithinSendingHours(tz)) {
    await collections.organizations.doc(orgId).update({
      kickoffPendingAt: Timestamp.now(),
    });
    return { queued: true, sent: 0, skipped: 0 };
  }

  // Find all PENDING_UPLOAD policies for the org
  const policiesSnap = await collections.policies
    .where("organizationId", "==", orgId)
    .get();

  let sent = 0;
  let skipped = 0;
  const since = Date.now() - 24 * 60 * 60 * 1000;

  for (const policyDoc of policiesSnap.docs) {
    const p = policyDoc.data();
    const state = getPolicyVerificationState(p as never, orgId, new Set());
    if (state !== VerificationState.PENDING_UPLOAD) {
      skipped++;
      continue;
    }

    // Skip if an intake link was sent recently
    const lastSent = p.lastIntakeSentAt?.toMillis?.() ?? 0;
    if (lastSent > since) {
      skipped++;
      continue;
    }

    // Throttle: 5/sec → 200ms between sends
    await new Promise((r) => setTimeout(r, 200));

    try {
      // Reuse the existing intake-request logic by importing the shared helper
      // (extract `createIntakeTokenAndNotify` from borrower-intake.ts in Step 2).
      await createIntakeTokenAndNotify({
        organizationId: orgId,
        borrowerId: p.borrowerId,
        vehicleId: p.vehicleId,
        policyId: policyDoc.id,
      });
      sent++;
    } catch (err) {
      logger.warn("[kickoff] failed for policy", { policyId: policyDoc.id, err: String(err) });
    }
  }

  await collections.organizations.doc(orgId).update({
    onboardingCompleted: true,
    kickoffCompletedAt: Timestamp.now(),
    kickoffSent: sent,
  });

  logger.info(`[kickoff] org=${orgId} sent=${sent} skipped=${skipped}`);
  return { queued: false, sent, skipped };
});
```

- [ ] **Step 2: Extract `createIntakeTokenAndNotify` from `borrower-intake.ts`**

Currently the intake-token + dual-channel send logic lives inline in [`functions/src/functions/borrower-intake.ts`](../../../functions/src/functions/borrower-intake.ts) inside `requestBorrowerIntake`. Extract the body (from `// Generate token` through the notification log) into an exported function `createIntakeTokenAndNotify(input)`. Have `requestBorrowerIntake` call it. Have the new kickoff function call it. **Do not change behavior** — pure refactor.

- [ ] **Step 3: Export**

In [`functions/src/index.ts`](../../../functions/src/index.ts):

```typescript
export { onOrgOnboardingComplete } from "./functions/onboarding-kickoff";
```

- [ ] **Step 4: Add a flush job for queued kickoffs**

In `dailyExpiryReminder` (or as a new tiny scheduled function `flushPendingKickoffs` at 8am CT), check for orgs with `kickoffPendingAt` set, fire their kickoff, and clear the field.

Decision: piggyback on `dailyExpiryReminder` (already runs 9am CT) to keep cron count down.

- [ ] **Step 5: Compile + commit**

```bash
cd functions; npm run build
git add functions/src/functions/onboarding-kickoff.ts functions/src/functions/borrower-intake.ts functions/src/functions/daily-expiry-reminder.ts functions/src/index.ts
git commit -m "feat(kickoff): bulk intake on onboarding, quiet-hours-aware"
```

### Task 4.2: Wire it from the onboarding wizard

**Files:**
- Modify: `frontend/src/components/onboarding-wizard.tsx`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the API client wrapper**

In [`frontend/src/lib/api.ts`](../../../frontend/src/lib/api.ts):

```typescript
export async function onOrgOnboardingComplete(): Promise<{ queued: boolean; sent: number; skipped: number }> {
  const fn = httpsCallable(getFunctions(), "onOrgOnboardingComplete");
  const result = await fn({});
  return result.data as { queued: boolean; sent: number; skipped: number };
}
```

- [ ] **Step 2: Call it from the wizard's final step**

In `frontend/src/components/onboarding-wizard.tsx`, on the "Finish" handler that currently sets `onboardingCompleted=true`, add:

```typescript
const result = await onOrgOnboardingComplete();
if (result.queued) {
  toast.info("Intake links will be sent tomorrow morning (quiet hours).");
} else if (result.sent > 0) {
  toast.success(`Sent ${result.sent} intake link${result.sent === 1 ? "" : "s"} to your borrowers.`);
}
```

- [ ] **Step 3: Manual test**

Sign up a new org, walk through onboarding with 2-3 PENDING_UPLOAD borrowers seeded. Expected: toast appears, intake notifications appear in Verifications tab, borrower phones receive SMS within ~1 minute.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/onboarding-wizard.tsx frontend/src/lib/api.ts
git commit -m "feat(wizard): trigger onboarding kickoff on finish"
```

---

## Chunk 5: Frontend Surfacing

Per-borrower badges, org-level header strip, collapsible sweep-run rows in Verifications tab, weekday selector in Org Profile.

### Task 5.1: Expose `verificationState` from `getBorrowers`

**Files:**
- Modify: `functions/src/functions/get-borrowers.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Compute state server-side**

In [`functions/src/functions/get-borrowers.ts`](../../../functions/src/functions/get-borrowers.ts), after the policy lookup for each borrower:

```typescript
import { getPolicyVerificationState } from "../services/verification-eligibility";

// One creds query per request (cache it for the org)
const credsSnap = await db
  .collection("organizations").doc(orgId)
  .collection("carrierCredentials")
  .where("active", "==", true).get();
const activeCarriers = new Set(credsSnap.docs.map((d) => d.id));

// per borrower:
const state = policy ? getPolicyVerificationState(policy, orgId, activeCarriers) : "PENDING_UPLOAD";
return { ...existingFields, verificationState: state, lastVerifiedAt: policy?.lastVerifiedAt ?? null };
```

- [ ] **Step 2: Update the API type**

In [`frontend/src/lib/api.ts`](../../../frontend/src/lib/api.ts), add to `BorrowerWithVehicles`:

```typescript
verificationState?: "PENDING_UPLOAD" | "INSURED_SUPPORTED" | "INSURED_UNSUPPORTED" | "INSURED_NO_CREDS";
lastVerifiedAt?: string | null;
```

- [ ] **Step 3: Compile + commit**

```bash
cd functions; npm run build
cd ../frontend; npm run build
git add functions/src/functions/get-borrowers.ts frontend/src/lib/api.ts
git commit -m "feat(api): surface verificationState on borrower list"
```

### Task 5.2: Build the badge component

**Files:**
- Create: `frontend/src/components/borrower-verification-badge.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { CheckCircle2, Clock, ShieldOff, KeyRound } from "lucide-react";

type State = "PENDING_UPLOAD" | "INSURED_SUPPORTED" | "INSURED_UNSUPPORTED" | "INSURED_NO_CREDS";

interface Props {
  state: State;
  lastVerifiedAt?: string | null;
}

export function BorrowerVerificationBadge({ state, lastVerifiedAt }: Props) {
  switch (state) {
    case "INSURED_SUPPORTED":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-400" title={lastVerifiedAt ? `Verified ${new Date(lastVerifiedAt).toLocaleString()}` : "Verified"}>
          <CheckCircle2 className="w-3 h-3" /> Verified
        </span>
      );
    case "PENDING_UPLOAD":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-yellow-400" title="Awaiting insurance upload">
          <Clock className="w-3 h-3" /> Awaiting upload
        </span>
      );
    case "INSURED_UNSUPPORTED":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-carbon-light" title="Carrier verification unavailable — relying on uploaded proof">
          <ShieldOff className="w-3 h-3" /> Manual
        </span>
      );
    case "INSURED_NO_CREDS":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-orange-400" title="Add carrier credentials to enable verification">
          <KeyRound className="w-3 h-3" /> Add credentials
        </span>
      );
  }
}
```

- [ ] **Step 2: Render it in the borrower table**

In [`frontend/src/components/borrower-table.tsx`](../../../frontend/src/components/borrower-table.tsx), import the badge and add a column (or include in the existing status column).

- [ ] **Step 3: Build + commit**

```bash
cd frontend; npm run build
git add frontend/src/components/borrower-verification-badge.tsx frontend/src/components/borrower-table.tsx
git commit -m "feat(ui): per-borrower verification state badge"
```

### Task 5.3: Header strip + Verifications tab grouping + Profile setting

**Files:**
- Create: `frontend/src/components/dashboard-header-strip.tsx`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/components/verifications-tab.tsx`
- Modify: `frontend/src/components/organization-profile-form.tsx`

- [ ] **Step 1: New `getOrgVerificationStatus` callable**

Add a tiny callable `getOrgVerificationStatus()` that returns `{ assignedDay, lastSweepAt, nextSweepAt, inScopeCount, totalCount }` by reading the most recent `dataFeedRuns` for the org and computing next-day-of-week.

- [ ] **Step 2: Build the header strip**

`frontend/src/components/dashboard-header-strip.tsx` renders the values in a single row above the borrower table. Hide it when no creds are set up yet (don't confuse first-run dealers).

- [ ] **Step 3: Verifications tab grouping**

In `frontend/src/components/verifications-tab.tsx`, group existing notifications by `runId` (notifications dispatched from the sweep already carry `runId` via the dispatcher). Render each run as a collapsible row showing run timestamp + per-policy results inside.

- [ ] **Step 4: Profile form weekday selector**

In `frontend/src/components/organization-profile-form.tsx`, add a `<select>` for verification day with options Mon/Tue/Wed/Thu/Fri. Default to the hash-derived value when unset. Saves to `settings.verificationDayOfWeek`.

- [ ] **Step 5: Build + manual smoke test**

```bash
cd frontend; npm run build
```

Open the app: confirm header strip renders, badge appears on borrower rows, weekday selector saves, Verifications tab groups by run.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat(ui): header strip, sweep run grouping, verification day selector"
```

---

## Final Deploy

- [ ] **Step 1: Build everything**

```bash
cd functions; npm run build
cd ../frontend; npm run build
```

- [ ] **Step 2: Deploy functions**

```bash
firebase deploy --only functions --non-interactive
```

- [ ] **Step 3: Deploy frontend**

```bash
vercel --prod --yes
```

- [ ] **Step 4: Post-deploy verification**

1. Confirm `weeklyDataFeedDispatcher` shows `0 7 * * 1-5` in Cloud Scheduler.
2. Trigger `simulateVerificationSweep` for one real org with Progressive policies.
3. Open dashboard, confirm header strip shows "Last sweep" timestamp from the simulator run.
4. Confirm at least one borrower row shows the green "Verified" badge.

If any step fails, roll back the relevant deploy and reopen.
