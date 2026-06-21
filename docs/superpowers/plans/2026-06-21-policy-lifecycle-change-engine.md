# Policy Lifecycle Change Engine — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect and act on *every* mid-term change to a borrower's insurance — cancellation, carrier switch, deductible increase, comprehensive→liability downgrade, expiration moved up, lienholder removed — by comparing each verification against the previous one, then notify the right party (borrower and/or lender) through the right channel, with a full audit trail.

**Architecture:** Today the system only evaluates a policy's *current* state against compliance thresholds; it has no concept of *change over time*. We add a **delta engine**: a pure `extractSnapshot()` + `diffPolicySnapshot()` pair that converts two policy states into a typed list of `PolicyChange` events. A single Firestore `onDocumentUpdated` trigger on `policies/{id}` is the chokepoint — it fires on writes from BOTH the operator sweep path and the Cloud Run engine path, guards so it only runs when a verification actually advanced (ignoring cadence-job writes), diffs the before/after, persists each change to a `policyChanges` collection (history), writes a `dashboardStatus`-transition audit entry, and dispatches change-driven borrower/lender notifications. We then close the named gaps: a carrier-switch branch that asks "did you switch insurers?" instead of firing a false lapse, onboarding compliance defaults (comprehensive/collision required for lienholder orgs) plus a borrower "notify us on any change" acknowledgment, and a weekly lender change digest plus change-type in the outbound webhook.

**Tech Stack:** TypeScript, Firebase Functions v2 (`onDocumentUpdated` + `onSchedule` + `onCall`), Firestore, Resend (email), Telnyx (SMS), Next.js 16 frontend, `node:test` unit tests compiled to `lib/**/*.test.js`.

**Source gap analysis:** the 2026-06-21 onboarding/lifecycle review (this session). Key current files: [functions/src/types/policy.ts](../../../functions/src/types/policy.ts), [functions/src/types/notification.ts](../../../functions/src/types/notification.ts), [functions/src/functions/manual-carrier-sweep.ts](../../../functions/src/functions/manual-carrier-sweep.ts), [functions/src/functions/daily-compliance-escalation.ts](../../../functions/src/functions/daily-compliance-escalation.ts), [functions/src/services/cadence-templates.ts](../../../functions/src/services/cadence-templates.ts), [functions/src/services/outbound-webhook.ts](../../../functions/src/services/outbound-webhook.ts).

---

## Conventions (read once)

- **Build:** `cd functions; npm run build` (runs `tsc`). Must pass before deploy.
- **Test:** `cd functions; npm test` runs `tsc && node --test "lib/**/*.test.js"`. New tests are `*.test.ts` co-located with source (compiled into `lib/`). To run a single file: `cd functions; npm run build; node --test "lib/services/policy-diff.test.js"`.
- **Test style:** `const test = require("node:test");` / `const assert = require("node:assert/strict");` — but since these are `.ts`, use `import test from "node:test";` and `import assert from "node:assert/strict";`.
- **Deploy:** from repo root, **one function per command**: `firebase deploy --only functions:NAME`. Do NOT chain multiple deploys in one PowerShell command (they stall).
- **PowerShell:** chain with `;`, never `&&`. `git push` writing to stderr → Exit Code 1 is still SUCCESS; verify the `oldsha..newsha main -> main` line.
- **Auth in callables:** `requireSuperAdmin(request)` returns void (throws otherwise). Caller email: `request.auth?.token?.email ?? "system"`.
- **Audit schema** ([functions/src/types/audit.ts](../../../functions/src/types/audit.ts)): `AuditLogEntry { organizationId, entityType (AuditEntityType), entityId, action (AuditAction|string), previousValue?, newValue?, performedBy, timestamp }`. Write via `collections.auditLog.add({...} as never)`.
- **Notifications dedupe store** is the `notifications` collection; cadence anchors live on the policy. Change notifications dedupe on `(policyChangeId)`.
- **Commit** after each task. **DEMO_ORG_ID** (`functions/src/constants.ts`) is always skipped by schedulers/triggers that send messages.

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `functions/src/types/policy-change.ts` | Create | `PolicyChangeType` enum, `PolicySnapshot`, `PolicyChange`, `Severity` |
| `functions/src/services/coverage-extract.ts` | Create | Pure: pull comprehensive/collision presence + deductible + expiration out of a policy's `coverageItems`/`coverages` |
| `functions/src/services/coverage-extract.test.ts` | Create | Unit tests for extraction |
| `functions/src/services/policy-snapshot.ts` | Create | Pure: `extractSnapshot(policy) → PolicySnapshot` |
| `functions/src/services/policy-snapshot.test.ts` | Create | Unit tests |
| `functions/src/services/policy-diff.ts` | Create | Pure: `diffPolicySnapshot(before, after) → PolicyChange[]` |
| `functions/src/services/policy-diff.test.ts` | Create | Unit tests — the heart of the feature |
| `functions/src/types/policy.ts` | Modify | Add `lastSnapshot?`, `possibleCarrierSwitch?`, `carrierSwitchDetectedAt?`, `policyChangeNoticeAck?` |
| `functions/src/functions/on-policy-verification-change.ts` | Create | Firestore `onDocumentUpdated` trigger: diff, persist changes, audit status transition, dispatch notifications |
| `functions/src/services/change-notifications.ts` | Create | Maps `PolicyChange[]` → borrower notifications (channel + template + dedupe) |
| `functions/src/services/change-notifications.test.ts` | Create | Unit tests for the mapping (pure decision function) |
| `functions/src/services/cadence-templates.ts` | Modify | Add email + SMS templates for the 6 change events |
| `functions/src/functions/manual-carrier-sweep.ts` | Modify | Carrier-switch branch: "no record at carrier" ≠ lapse |
| `functions/src/services/carrier-switch.ts` | Create | Pure: classify a sweep outcome as `LAPSE` vs `POSSIBLE_SWITCH` vs `OK` |
| `functions/src/services/carrier-switch.test.ts` | Create | Unit tests |
| `functions/src/types/organization.ts` | Modify | `DEFAULT_COMPLIANCE_RULES` with comp/collision required for lienholder orgs |
| `functions/src/services/compliance-defaults.ts` | Create | Pure: `defaultComplianceRules(orgType) → ComplianceRules` |
| `functions/src/services/compliance-defaults.test.ts` | Create | Unit tests |
| `functions/src/functions/onboarding-kickoff.ts` or org-create path | Modify | Apply defaults when compliance rules unset on onboarding complete |
| `functions/src/services/outbound-webhook.ts` | Modify | Add `changeType`/`changes` to `PolicyStatusWebhookPayload` |
| `functions/src/functions/weekly-lender-change-digest.ts` | Create | `onSchedule` weekly: per-org change summary email to admins |
| `functions/src/services/lender-email.ts` | Modify | Add `sendLenderChangeDigestEmail()` |
| `functions/src/index.ts` | Modify | Export trigger + digest |
| `firestore.indexes.json` | Modify | Composite indexes for `policyChanges` queries |
| `frontend/src/lib/api.ts` | Modify | `PolicyChange` type + `callGetPolicyChanges` |
| `frontend/src/components/admin-borrower-support.tsx` | Modify | Render change timeline in the support drawer |
| `frontend/src/components/onboarding-wizard.tsx` | Modify | Surface comp/collision/deductible defaults + borrower-change-notice copy |
| `frontend/src/components/add-borrower-dialog.tsx` | Modify | Add "notify us on any policy change" acknowledgment copy |

---

## Chunk 1: Delta Engine Foundation (pure, no behavior change)

Introduces the snapshot + diff core. Everything is pure and unit-tested. Nothing in production behavior changes yet — after this chunk the code compiles and deploys, but no trigger consumes the engine.

### Task 1.1: Policy-change types

**Files:**
- Create: `functions/src/types/policy-change.ts`

- [ ] **Step 1: Create the types**

```typescript
import { Timestamp } from "firebase-admin/firestore";

/**
 * Typed lifecycle changes detected by diffing two policy verification
 * snapshots. Each maps to a borrower/lender communication decision.
 */
export enum PolicyChangeType {
  CARRIER_CHANGED = "CARRIER_CHANGED",
  COVERAGE_DOWNGRADED = "COVERAGE_DOWNGRADED", // comprehensive and/or collision dropped
  DEDUCTIBLE_INCREASED = "DEDUCTIBLE_INCREASED",
  EXPIRATION_MOVED_UP = "EXPIRATION_MOVED_UP", // term shortened / cancels earlier
  POLICY_LAPSED = "POLICY_LAPSED", // ACTIVE -> CANCELLED/EXPIRED/RESCINDED
  POLICY_REINSTATED = "POLICY_REINSTATED", // lapsed -> ACTIVE
  LIENHOLDER_REMOVED = "LIENHOLDER_REMOVED",
  LIENHOLDER_ADDED = "LIENHOLDER_ADDED",
  STATUS_CHANGED = "STATUS_CHANGED", // catch-all status transition (audit only)
}

export type ChangeSeverity = "info" | "warning" | "critical";

/**
 * The minimal, comparable shape of a policy's verified coverage. Produced by
 * extractSnapshot(); compared by diffPolicySnapshot().
 */
export interface PolicySnapshot {
  status: string; // PolicyStatus
  insuranceProvider: string | null; // normalized carrier id, lowercased
  policyNumber: string | null;
  hasComprehensive: boolean;
  hasCollision: boolean;
  comprehensiveDeductible: number | null;
  collisionDeductible: number | null;
  expirationMs: number | null; // coveragePeriod.endDate as epoch ms
  isLienholderListed: boolean;
  dashboardStatus: string; // GREEN | YELLOW | RED
}

export interface PolicyChange {
  id?: string;
  organizationId: string;
  borrowerId: string;
  policyId: string;
  type: PolicyChangeType;
  severity: ChangeSeverity;
  /** Human-readable, e.g. "Comprehensive deductible increased $300 → $1,500". */
  summary: string;
  previousValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
  /** Set once a borrower/lender notification is dispatched for this change. */
  notifiedAt?: Timestamp;
  createdAt: Timestamp;
}
```

- [ ] **Step 2: Compile**

Run: `cd functions; npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/types/policy-change.ts
git commit -m "types: add PolicyChange + PolicySnapshot lifecycle change types"
```

---

### Task 1.2: Coverage extraction helper

The hard part of snapshotting is pulling comprehensive/collision presence + deductibles out of the policy's `coverageItems` (rich) or legacy `coverages`. Isolate it so it's independently testable.

**Files:**
- Create: `functions/src/services/coverage-extract.ts`
- Test: `functions/src/services/coverage-extract.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCoverage,
} from "./coverage-extract";

test("extractCoverage reads rich coverageItems comprehensive + collision deductibles", () => {
  const policy = {
    coverageItems: [
      { type: "Comprehensive", deductibles: [{ amount: 500 }] },
      { type: "Collision", deductibles: [{ amount: 1000 }] },
    ],
  };
  const c = extractCoverage(policy);
  assert.equal(c.hasComprehensive, true);
  assert.equal(c.hasCollision, true);
  assert.equal(c.comprehensiveDeductible, 500);
  assert.equal(c.collisionDeductible, 1000);
});

test("extractCoverage falls back to legacy coverages array", () => {
  const policy = {
    coverages: [{ type: "comprehensive", deductible: 250 }],
  };
  const c = extractCoverage(policy);
  assert.equal(c.hasComprehensive, true);
  assert.equal(c.hasCollision, false);
  assert.equal(c.comprehensiveDeductible, 250);
  assert.equal(c.collisionDeductible, null);
});

test("extractCoverage liability-only policy has no comp/collision", () => {
  const policy = {
    coverageItems: [{ type: "Bodily Injury Liability", deductibles: [] }],
  };
  const c = extractCoverage(policy);
  assert.equal(c.hasComprehensive, false);
  assert.equal(c.hasCollision, false);
});

test("extractCoverage returns null deductible when amount missing", () => {
  const policy = {
    coverageItems: [{ type: "Comprehensive", deductibles: [{ text: "n/a" }] }],
  };
  const c = extractCoverage(policy);
  assert.equal(c.hasComprehensive, true);
  assert.equal(c.comprehensiveDeductible, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions; npm run build`
Expected: FAIL — `Cannot find module './coverage-extract'`.

- [ ] **Step 3: Implement**

```typescript
/**
 * Pure helpers to pull comprehensive/collision presence + deductibles out of a
 * policy regardless of whether it stores rich `coverageItems` or legacy
 * `coverages`. No Firestore access.
 */

interface CoverageDeductibleLike {
  amount?: number;
  text?: string;
}
interface CoverageItemLike {
  type?: string;
  deductibles?: CoverageDeductibleLike[];
}
interface LegacyCoverageLike {
  type?: string;
  deductible?: number;
}
interface PolicyLike {
  coverageItems?: CoverageItemLike[];
  coverages?: LegacyCoverageLike[];
}

export interface ExtractedCoverage {
  hasComprehensive: boolean;
  hasCollision: boolean;
  comprehensiveDeductible: number | null;
  collisionDeductible: number | null;
}

function matches(type: string | undefined, needle: string): boolean {
  return (type ?? "").toLowerCase().includes(needle);
}

function firstDeductible(item: CoverageItemLike): number | null {
  for (const d of item.deductibles ?? []) {
    if (typeof d.amount === "number") return d.amount;
  }
  return null;
}

export function extractCoverage(policy: PolicyLike): ExtractedCoverage {
  const result: ExtractedCoverage = {
    hasComprehensive: false,
    hasCollision: false,
    comprehensiveDeductible: null,
    collisionDeductible: null,
  };

  for (const item of policy.coverageItems ?? []) {
    if (matches(item.type, "comprehensive")) {
      result.hasComprehensive = true;
      result.comprehensiveDeductible = firstDeductible(item);
    } else if (matches(item.type, "collision")) {
      result.hasCollision = true;
      result.collisionDeductible = firstDeductible(item);
    }
  }

  // Legacy fallback only if rich items did not establish the coverage.
  for (const cov of policy.coverages ?? []) {
    if (matches(cov.type, "comprehensive") && !result.hasComprehensive) {
      result.hasComprehensive = true;
      result.comprehensiveDeductible =
        typeof cov.deductible === "number" ? cov.deductible : null;
    } else if (matches(cov.type, "collision") && !result.hasCollision) {
      result.hasCollision = true;
      result.collisionDeductible =
        typeof cov.deductible === "number" ? cov.deductible : null;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions; npm test`
Expected: 4 coverage-extract tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/coverage-extract.ts functions/src/services/coverage-extract.test.ts
git commit -m "feat: coverage-extract helper for comp/collision deductibles"
```

---

### Task 1.3: extractSnapshot

**Files:**
- Create: `functions/src/services/policy-snapshot.ts`
- Test: `functions/src/services/policy-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { extractSnapshot } from "./policy-snapshot";

test("extractSnapshot normalizes carrier and parses expiration to ms", () => {
  const snap = extractSnapshot({
    status: "ACTIVE",
    insuranceProvider: "Progressive",
    policyNumber: "P123",
    coveragePeriod: { startDate: "2026-01-01", endDate: "2026-07-01" },
    isLienholderListed: true,
    dashboardStatus: "GREEN",
    coverageItems: [{ type: "Comprehensive", deductibles: [{ amount: 500 }] }],
  });
  assert.equal(snap.status, "ACTIVE");
  assert.equal(snap.insuranceProvider, "progressive");
  assert.equal(snap.policyNumber, "P123");
  assert.equal(snap.hasComprehensive, true);
  assert.equal(snap.comprehensiveDeductible, 500);
  assert.equal(snap.expirationMs, new Date("2026-07-01").getTime());
  assert.equal(snap.isLienholderListed, true);
  assert.equal(snap.dashboardStatus, "GREEN");
});

test("extractSnapshot handles missing fields safely", () => {
  const snap = extractSnapshot({});
  assert.equal(snap.insuranceProvider, null);
  assert.equal(snap.expirationMs, null);
  assert.equal(snap.isLienholderListed, false);
  assert.equal(snap.hasComprehensive, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions; npm run build`
Expected: FAIL — `Cannot find module './policy-snapshot'`.

- [ ] **Step 3: Implement**

```typescript
import type { PolicySnapshot } from "../types/policy-change";
import { extractCoverage } from "./coverage-extract";

interface PolicyLike {
  status?: string;
  insuranceProvider?: string;
  policyNumber?: string;
  coveragePeriod?: { startDate?: string; endDate?: string };
  isLienholderListed?: boolean;
  dashboardStatus?: string;
  coverageItems?: unknown;
  coverages?: unknown;
}

function normalizeCarrier(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.trim().toLowerCase().replace(/\s+/g, "_") || null;
}

function toMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function extractSnapshot(policy: PolicyLike): PolicySnapshot {
  const cov = extractCoverage(policy as never);
  return {
    status: policy.status ?? "NOT_AVAILABLE",
    insuranceProvider: normalizeCarrier(policy.insuranceProvider),
    policyNumber: policy.policyNumber ?? null,
    hasComprehensive: cov.hasComprehensive,
    hasCollision: cov.hasCollision,
    comprehensiveDeductible: cov.comprehensiveDeductible,
    collisionDeductible: cov.collisionDeductible,
    expirationMs: toMs(policy.coveragePeriod?.endDate),
    isLienholderListed: policy.isLienholderListed ?? false,
    dashboardStatus: policy.dashboardStatus ?? "GREEN",
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions; npm test`
Expected: snapshot tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/policy-snapshot.ts functions/src/services/policy-snapshot.test.ts
git commit -m "feat: extractSnapshot reduces a policy to a comparable snapshot"
```

---

### Task 1.4: diffPolicySnapshot — the heart of the feature

**Files:**
- Create: `functions/src/services/policy-diff.ts`
- Test: `functions/src/services/policy-diff.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { diffPolicySnapshot } from "./policy-diff";
import { PolicyChangeType } from "../types/policy-change";
import type { PolicySnapshot } from "../types/policy-change";

const base: PolicySnapshot = {
  status: "ACTIVE",
  insuranceProvider: "progressive",
  policyNumber: "P1",
  hasComprehensive: true,
  hasCollision: true,
  comprehensiveDeductible: 500,
  collisionDeductible: 500,
  expirationMs: new Date("2026-12-01").getTime(),
  isLienholderListed: true,
  dashboardStatus: "GREEN",
};

function types(changes: { type: PolicyChangeType }[]) {
  return changes.map((c) => c.type);
}

test("no change yields empty list", () => {
  assert.deepEqual(diffPolicySnapshot(base, { ...base }), []);
});

test("carrier switch detected", () => {
  const changes = diffPolicySnapshot(base, { ...base, insuranceProvider: "state_farm" });
  assert.ok(types(changes).includes(PolicyChangeType.CARRIER_CHANGED));
});

test("comprehensive dropped is a downgrade (critical)", () => {
  const changes = diffPolicySnapshot(base, { ...base, hasComprehensive: false, comprehensiveDeductible: null });
  const dg = changes.find((c) => c.type === PolicyChangeType.COVERAGE_DOWNGRADED);
  assert.ok(dg);
  assert.equal(dg!.severity, "critical");
});

test("deductible increase detected with summary", () => {
  const changes = diffPolicySnapshot(base, { ...base, comprehensiveDeductible: 1500 });
  const d = changes.find((c) => c.type === PolicyChangeType.DEDUCTIBLE_INCREASED);
  assert.ok(d);
  assert.equal(d!.previousValue, 500);
  assert.equal(d!.newValue, 1500);
});

test("deductible decrease is NOT flagged", () => {
  const changes = diffPolicySnapshot(base, { ...base, comprehensiveDeductible: 250 });
  assert.equal(changes.find((c) => c.type === PolicyChangeType.DEDUCTIBLE_INCREASED), undefined);
});

test("expiration moved earlier is flagged", () => {
  const changes = diffPolicySnapshot(base, { ...base, expirationMs: new Date("2026-08-01").getTime() });
  assert.ok(types(changes).includes(PolicyChangeType.EXPIRATION_MOVED_UP));
});

test("expiration extended is NOT flagged", () => {
  const changes = diffPolicySnapshot(base, { ...base, expirationMs: new Date("2027-12-01").getTime() });
  assert.equal(types(changes).includes(PolicyChangeType.EXPIRATION_MOVED_UP), false);
});

test("lapse detected when active -> cancelled", () => {
  const changes = diffPolicySnapshot(base, { ...base, status: "CANCELLED" });
  const lapse = changes.find((c) => c.type === PolicyChangeType.POLICY_LAPSED);
  assert.ok(lapse);
  assert.equal(lapse!.severity, "critical");
});

test("reinstatement detected when cancelled -> active", () => {
  const lapsed = { ...base, status: "CANCELLED" };
  const changes = diffPolicySnapshot(lapsed, { ...base, status: "ACTIVE" });
  assert.ok(types(changes).includes(PolicyChangeType.POLICY_REINSTATED));
});

test("lienholder removed flagged critical", () => {
  const changes = diffPolicySnapshot(base, { ...base, isLienholderListed: false });
  const lh = changes.find((c) => c.type === PolicyChangeType.LIENHOLDER_REMOVED);
  assert.ok(lh);
  assert.equal(lh!.severity, "critical");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions; npm run build`
Expected: FAIL — `Cannot find module './policy-diff'`.

- [ ] **Step 3: Implement**

```typescript
import { PolicyChangeType, type ChangeSeverity } from "../types/policy-change";
import type { PolicySnapshot } from "../types/policy-change";

/** Bare change shape returned by the pure diff (no ids/timestamps yet). */
export interface RawPolicyChange {
  type: PolicyChangeType;
  severity: ChangeSeverity;
  summary: string;
  previousValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
}

const LAPSED = new Set(["CANCELLED", "EXPIRED", "RESCINDED"]);

function money(n: number | null): string {
  return n === null ? "none" : `$${n.toLocaleString("en-US")}`;
}

/**
 * Compare two snapshots and return the typed list of lifecycle changes.
 * Pure: no Firestore, no time, deterministic. Only flags changes that matter
 * to a lienholder (increases/downgrades/lapses), never improvements.
 */
export function diffPolicySnapshot(
  before: PolicySnapshot,
  after: PolicySnapshot,
): RawPolicyChange[] {
  const changes: RawPolicyChange[] = [];

  // ── Lapse / reinstatement (status transitions) ──
  const wasLapsed = LAPSED.has(before.status);
  const isLapsed = LAPSED.has(after.status);
  if (!wasLapsed && isLapsed) {
    changes.push({
      type: PolicyChangeType.POLICY_LAPSED,
      severity: "critical",
      summary: `Policy ${before.status} → ${after.status} (coverage lapsed)`,
      previousValue: before.status,
      newValue: after.status,
    });
  } else if (wasLapsed && after.status === "ACTIVE") {
    changes.push({
      type: PolicyChangeType.POLICY_REINSTATED,
      severity: "info",
      summary: "Coverage reinstated (policy active again)",
      previousValue: before.status,
      newValue: after.status,
    });
  }

  // ── Carrier switch ──
  if (
    before.insuranceProvider &&
    after.insuranceProvider &&
    before.insuranceProvider !== after.insuranceProvider
  ) {
    changes.push({
      type: PolicyChangeType.CARRIER_CHANGED,
      severity: "warning",
      summary: `Carrier changed: ${before.insuranceProvider} → ${after.insuranceProvider}`,
      previousValue: before.insuranceProvider,
      newValue: after.insuranceProvider,
    });
  }

  // ── Coverage downgrade (comprehensive or collision dropped) ──
  const comprehensiveDropped = before.hasComprehensive && !after.hasComprehensive;
  const collisionDropped = before.hasCollision && !after.hasCollision;
  if (comprehensiveDropped || collisionDropped) {
    const lost = [
      comprehensiveDropped ? "comprehensive" : null,
      collisionDropped ? "collision" : null,
    ]
      .filter(Boolean)
      .join(" + ");
    changes.push({
      type: PolicyChangeType.COVERAGE_DOWNGRADED,
      severity: "critical",
      summary: `Physical-damage coverage dropped: ${lost} removed`,
      previousValue: `comp:${before.hasComprehensive} coll:${before.hasCollision}`,
      newValue: `comp:${after.hasComprehensive} coll:${after.hasCollision}`,
    });
  }

  // ── Deductible increases (each line independently) ──
  for (const [label, b, a] of [
    ["Comprehensive", before.comprehensiveDeductible, after.comprehensiveDeductible],
    ["Collision", before.collisionDeductible, after.collisionDeductible],
  ] as const) {
    if (b !== null && a !== null && a > b) {
      changes.push({
        type: PolicyChangeType.DEDUCTIBLE_INCREASED,
        severity: "warning",
        summary: `${label} deductible increased ${money(b)} → ${money(a)}`,
        previousValue: b,
        newValue: a,
      });
    }
  }

  // ── Expiration moved earlier ──
  if (
    before.expirationMs !== null &&
    after.expirationMs !== null &&
    after.expirationMs < before.expirationMs
  ) {
    changes.push({
      type: PolicyChangeType.EXPIRATION_MOVED_UP,
      severity: "warning",
      summary: `Policy expiration moved earlier: ${new Date(before.expirationMs)
        .toISOString()
        .slice(0, 10)} → ${new Date(after.expirationMs).toISOString().slice(0, 10)}`,
      previousValue: new Date(before.expirationMs).toISOString().slice(0, 10),
      newValue: new Date(after.expirationMs).toISOString().slice(0, 10),
    });
  }

  // ── Lienholder add/remove ──
  if (before.isLienholderListed && !after.isLienholderListed) {
    changes.push({
      type: PolicyChangeType.LIENHOLDER_REMOVED,
      severity: "critical",
      summary: "Lienholder removed from policy",
      previousValue: true,
      newValue: false,
    });
  } else if (!before.isLienholderListed && after.isLienholderListed) {
    changes.push({
      type: PolicyChangeType.LIENHOLDER_ADDED,
      severity: "info",
      summary: "Lienholder added to policy",
      previousValue: false,
      newValue: true,
    });
  }

  return changes;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions; npm test`
Expected: all policy-diff tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/policy-diff.ts functions/src/services/policy-diff.test.ts
git commit -m "feat: diffPolicySnapshot — typed lifecycle change detection"
```

---

## Chunk 2: Persist changes + status-transition audit trail

Wires the delta engine into a single Firestore trigger that fires on every policy write, guards so only real verifications are processed, persists each change, and audits dashboardStatus transitions. No borrower/lender messages yet (Chunk 3) — this chunk produces the history + audit data.

### Task 2.1: Policy type additions

**Files:**
- Modify: `functions/src/types/policy.ts`

- [ ] **Step 1: Add fields to the `Policy` interface**

Add these just before `createdAt: Timestamp;`:

```typescript
  /**
   * Snapshot of the last *verified* coverage state, written by the
   * on-policy-verification-change trigger after it diffs an update. Used as
   * the "before" baseline for the next verification's diff.
   */
  lastSnapshot?: PolicySnapshot;
  /**
   * Set when a sweep finds NO policy record at the carrier on file (as opposed
   * to an explicit CANCELLED). Indicates the borrower may have switched
   * insurers; drives the "confirm coverage" intake instead of a false lapse.
   */
  possibleCarrierSwitch?: boolean;
  carrierSwitchDetectedAt?: Timestamp;
  /** Borrower acknowledged at intake they must report policy changes. */
  policyChangeNoticeAck?: boolean;
```

Add the import at the top (with the other type imports):

```typescript
import type { PolicySnapshot } from "./policy-change";
```

- [ ] **Step 2: Compile**

Run: `cd functions; npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/types/policy.ts
git commit -m "types: add lastSnapshot + carrier-switch fields to Policy"
```

---

### Task 2.2: The verification-change trigger (persist + audit)

**Files:**
- Create: `functions/src/functions/on-policy-verification-change.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Implement the trigger**

```typescript
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { DEMO_ORG_ID } from "../constants";
import { extractSnapshot } from "../services/policy-snapshot";
import { diffPolicySnapshot } from "../services/policy-diff";
import { AuditEntityType, AuditAction } from "../types/audit";
import { dispatchChangeNotifications } from "../services/change-notifications";

/**
 * Single chokepoint for policy-change detection. Fires on EVERY write to a
 * policy doc (operator sweep path AND Cloud Run engine path), but only acts
 * when a verification actually advanced — guarded by lastVerifiedAt /
 * lastVerificationAttempt moving forward. This excludes cadence-job writes
 * (which only touch lapseDetectedAt / notification anchors), so we never
 * loop and never diff a non-verification edit.
 *
 * Writes: policyChanges history docs + auditLog dashboardStatus transitions.
 * Dispatches change-driven borrower/lender notifications (Chunk 3).
 */
export const onPolicyVerificationChange = onDocumentUpdated(
  {
    document: "policies/{policyId}",
    region: "us-central1",
    memory: "256MiB",
    retryCount: 0,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (after.organizationId === DEMO_ORG_ID) return;

    // Guard: only proceed when a verification advanced.
    const beforeVerifiedMs = tsMs(before.lastVerifiedAt);
    const afterVerifiedMs = tsMs(after.lastVerifiedAt);
    const beforeAttemptMs = tsMs(before.lastVerificationAttempt);
    const afterAttemptMs = tsMs(after.lastVerificationAttempt);
    const verificationAdvanced =
      afterVerifiedMs > beforeVerifiedMs || afterAttemptMs > beforeAttemptMs;
    if (!verificationAdvanced) return;

    const policyId = event.params.policyId;
    const orgId = after.organizationId as string;
    const borrowerId = (after.borrowerId as string) ?? "";

    // Baseline: persisted lastSnapshot if present, else the "before" doc.
    const beforeSnap = after.lastSnapshot ?? extractSnapshot(before);
    const afterSnap = extractSnapshot(after);
    const rawChanges = diffPolicySnapshot(beforeSnap, afterSnap);

    const batch = db.batch();
    const now = FieldValue.serverTimestamp();

    // Persist the new snapshot baseline for next time.
    batch.update(event.data!.after.ref, { lastSnapshot: afterSnap });

    // dashboardStatus transition audit (every transition, not just overrides).
    if (beforeSnap.dashboardStatus !== afterSnap.dashboardStatus) {
      const auditRef = collections.auditLog.doc();
      batch.set(auditRef, {
        organizationId: orgId,
        entityType: AuditEntityType.POLICY,
        entityId: policyId,
        action: AuditAction.STATUS_CHANGED,
        previousValue: beforeSnap.dashboardStatus,
        newValue: afterSnap.dashboardStatus,
        performedBy: "verification-system",
        timestamp: now,
      } as never);
    }

    const persistedChangeIds: string[] = [];
    for (const rc of rawChanges) {
      const ref = collections.policyChanges.doc();
      persistedChangeIds.push(ref.id);
      batch.set(ref, {
        organizationId: orgId,
        borrowerId,
        policyId,
        type: rc.type,
        severity: rc.severity,
        summary: rc.summary,
        previousValue: rc.previousValue,
        newValue: rc.newValue,
        createdAt: now,
      });
    }

    await batch.commit();

    if (rawChanges.length > 0) {
      logger.info("policy changes detected", {
        policyId,
        orgId,
        changes: rawChanges.map((c) => c.type),
      });
      // Dispatch borrower/lender notifications (Chunk 3). Fire-and-forget so
      // notification failures never block change persistence.
      await dispatchChangeNotifications({
        organizationId: orgId,
        borrowerId,
        policyId,
        changeIds: persistedChangeIds,
        changes: rawChanges,
      }).catch((err) =>
        logger.error("change notification dispatch failed", { policyId, err }),
      );
    }
  },
);

function tsMs(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}
```

- [ ] **Step 2: Add `policyChanges` to the firestore collections helper**

In [functions/src/config/firestore.ts](../../../functions/src/config/firestore.ts), add to the `collections` object (mirror the existing pattern, e.g. next to `auditLog`):

```typescript
  policyChanges: db.collection("policyChanges"),
```

- [ ] **Step 3: Stub `dispatchChangeNotifications` so this chunk compiles**

Create `functions/src/services/change-notifications.ts` with a no-op stub (real impl in Chunk 3):

```typescript
import type { RawPolicyChange } from "./policy-diff";

export interface DispatchChangeInput {
  organizationId: string;
  borrowerId: string;
  policyId: string;
  changeIds: string[];
  changes: RawPolicyChange[];
}

/** Stub — replaced with real borrower/lender dispatch in Chunk 3. */
export async function dispatchChangeNotifications(
  _input: DispatchChangeInput,
): Promise<void> {
  return;
}
```

- [ ] **Step 4: Export the trigger**

In [functions/src/index.ts](../../../functions/src/index.ts):

```typescript
export { onPolicyVerificationChange } from "./functions/on-policy-verification-change";
```

- [ ] **Step 5: Build**

Run: `cd functions; npm run build`
Expected: no errors. (Confirm `AuditAction.STATUS_CHANGED` and `AuditEntityType.POLICY` exist in `types/audit.ts`; if the enum member differs, use the actual name.)

- [ ] **Step 6: Deploy the trigger**

From repo root: `firebase deploy --only functions:onPolicyVerificationChange`
Expected: "Successful create operation".

- [ ] **Step 7: Commit**

```bash
git add functions/src/functions/on-policy-verification-change.ts functions/src/services/change-notifications.ts functions/src/config/firestore.ts functions/src/index.ts
git commit -m "feat: onPolicyVerificationChange trigger persists changes + audits status transitions"
```

---

### Task 2.3: Firestore indexes for policyChanges

**Files:**
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Add composite indexes**

Add to the top of the `indexes` array:

```json
{
  "collectionGroup": "policyChanges",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "organizationId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "policyChanges",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "policyId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

- [ ] **Step 2: Deploy indexes**

From repo root: `firebase deploy --only firestore:indexes`
Expected: deploy succeeds (index build may take a few minutes).

- [ ] **Step 3: Commit**

```bash
git add firestore.indexes.json
git commit -m "feat: composite indexes for policyChanges queries"
```

---

## Chunk 3: Change-driven borrower + lender notifications

Turns detected changes into the right message to the right party. This is where "notify the borrower / notify the lender" gets answered for each lifecycle event.

### Task 3.1: New notification triggers

**Files:**
- Modify: `functions/src/types/notification.ts`

- [ ] **Step 1: Add triggers to the enum**

In the `NotificationTrigger` enum, add a new section (REINSTATEMENT_REMINDER and VERIFICATION_PROOF_REQUEST already exist — we will finally wire them):

```typescript
  // Mid-term coverage change events (delta engine)
  CARRIER_CHANGED = "CARRIER_CHANGED",
  COVERAGE_DOWNGRADED = "COVERAGE_DOWNGRADED",
  DEDUCTIBLE_INCREASED = "DEDUCTIBLE_INCREASED",
  EXPIRATION_MOVED_UP = "EXPIRATION_MOVED_UP",
```

- [ ] **Step 2: Compile + commit**

Run: `cd functions; npm run build`

```bash
git add functions/src/types/notification.ts
git commit -m "types: add change-driven notification triggers"
```

---

### Task 3.2: Change → notification decision (pure, tested)

Decide, per change, WHO to notify and on WHICH channel — without doing any I/O — so it is unit-testable.

**Files:**
- Create: `functions/src/services/change-notification-policy.ts`
- Test: `functions/src/services/change-notification-policy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { decideChangeNotifications } from "./change-notification-policy";
import { PolicyChangeType } from "../types/policy-change";

test("coverage downgrade notifies BOTH borrower and lender", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.COVERAGE_DOWNGRADED, severity: "critical" },
  ]);
  assert.equal(d.notifyBorrower, true);
  assert.equal(d.notifyLender, true);
});

test("carrier change asks borrower to confirm + alerts lender", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.CARRIER_CHANGED, severity: "warning" },
  ]);
  assert.equal(d.notifyBorrower, true);
  assert.equal(d.notifyLender, true);
  assert.equal(d.borrowerTrigger, "VERIFICATION_PROOF_REQUEST");
});

test("reinstatement notifies borrower only (confirmation), info severity", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.POLICY_REINSTATED, severity: "info" },
  ]);
  assert.equal(d.notifyBorrower, true);
  assert.equal(d.notifyLender, false);
  assert.equal(d.borrowerTrigger, "REINSTATEMENT_REMINDER");
});

test("lienholder added is silent (no borrower spam), lender info only", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.LIENHOLDER_ADDED, severity: "info" },
  ]);
  assert.equal(d.notifyBorrower, false);
  assert.equal(d.notifyLender, false);
});

test("highest severity wins for lender alert level", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.DEDUCTIBLE_INCREASED, severity: "warning" },
    { type: PolicyChangeType.POLICY_LAPSED, severity: "critical" },
  ]);
  assert.equal(d.lenderSeverity, "critical");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions; npm run build`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { PolicyChangeType, type ChangeSeverity } from "../types/policy-change";

interface ChangeLike {
  type: PolicyChangeType;
  severity: ChangeSeverity;
}

export interface ChangeNotificationDecision {
  notifyBorrower: boolean;
  notifyLender: boolean;
  /** Trigger used for the borrower message, if any. */
  borrowerTrigger:
    | "VERIFICATION_PROOF_REQUEST"
    | "REINSTATEMENT_REMINDER"
    | "COVERAGE_DOWNGRADED"
    | "DEDUCTIBLE_INCREASED"
    | "EXPIRATION_MOVED_UP"
    | null;
  lenderSeverity: ChangeSeverity | null;
}

const RANK: Record<ChangeSeverity, number> = { info: 0, warning: 1, critical: 2 };

/**
 * Pure routing decision: given the changes from one verification, decide who
 * gets told and how. POLICY_LAPSED is intentionally excluded from the borrower
 * branch here — the existing lapse cadence (daily-lapse-auto-request) owns
 * borrower lapse messaging; we only surface it to the lender + audit.
 */
export function decideChangeNotifications(
  changes: ChangeLike[],
): ChangeNotificationDecision {
  let notifyBorrower = false;
  let notifyLender = false;
  let borrowerTrigger: ChangeNotificationDecision["borrowerTrigger"] = null;
  let lenderSeverity: ChangeSeverity | null = null;

  const bump = (s: ChangeSeverity) => {
    if (!lenderSeverity || RANK[s] > RANK[lenderSeverity]) lenderSeverity = s;
  };

  for (const c of changes) {
    switch (c.type) {
      case PolicyChangeType.CARRIER_CHANGED:
        notifyBorrower = true;
        notifyLender = true;
        borrowerTrigger = borrowerTrigger ?? "VERIFICATION_PROOF_REQUEST";
        bump(c.severity);
        break;
      case PolicyChangeType.COVERAGE_DOWNGRADED:
        notifyBorrower = true;
        notifyLender = true;
        borrowerTrigger = "COVERAGE_DOWNGRADED";
        bump(c.severity);
        break;
      case PolicyChangeType.DEDUCTIBLE_INCREASED:
        notifyBorrower = true;
        notifyLender = true;
        if (!borrowerTrigger) borrowerTrigger = "DEDUCTIBLE_INCREASED";
        bump(c.severity);
        break;
      case PolicyChangeType.EXPIRATION_MOVED_UP:
        notifyBorrower = true;
        notifyLender = true;
        if (!borrowerTrigger) borrowerTrigger = "EXPIRATION_MOVED_UP";
        bump(c.severity);
        break;
      case PolicyChangeType.LIENHOLDER_REMOVED:
        notifyBorrower = true;
        notifyLender = true;
        if (!borrowerTrigger) borrowerTrigger = "VERIFICATION_PROOF_REQUEST";
        bump(c.severity);
        break;
      case PolicyChangeType.POLICY_REINSTATED:
        notifyBorrower = true;
        borrowerTrigger = borrowerTrigger ?? "REINSTATEMENT_REMINDER";
        break;
      case PolicyChangeType.POLICY_LAPSED:
        notifyLender = true;
        bump(c.severity);
        break;
      case PolicyChangeType.LIENHOLDER_ADDED:
      case PolicyChangeType.STATUS_CHANGED:
      default:
        break;
    }
  }

  return { notifyBorrower, notifyLender, borrowerTrigger, lenderSeverity };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions; npm test`
Expected: decision tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/change-notification-policy.ts functions/src/services/change-notification-policy.test.ts
git commit -m "feat: pure change->notification routing decision"
```

---

### Task 3.3: Change message templates

**Files:**
- Modify: `functions/src/services/cadence-templates.ts`

- [ ] **Step 1: Add a change-template function**

Append a new exported helper that returns `{ subject, html, sms }` for a change summary. Reuse `layoutHtml`. Keep the legal "you must maintain coverage / lender may force-place" framing consistent with existing final-notice copy.

```typescript
export type ChangeMessageKind =
  | "VERIFICATION_PROOF_REQUEST"
  | "REINSTATEMENT_REMINDER"
  | "COVERAGE_DOWNGRADED"
  | "DEDUCTIBLE_INCREASED"
  | "EXPIRATION_MOVED_UP";

export function changeMessage(
  kind: ChangeMessageKind,
  args: {
    dealershipName: string;
    firstName?: string;
    summary: string;
    intakeUrl?: string;
  },
): { subject: string; html: string; sms: string } {
  const hi = args.firstName ? `Hi ${args.firstName}, ` : "";
  const action = args.intakeUrl
    ? `Please confirm your current coverage here: ${args.intakeUrl}`
    : "Please contact us with your current insurance details.";

  switch (kind) {
    case "VERIFICATION_PROOF_REQUEST":
      return {
        subject: `Action needed: confirm your insurance — ${args.dealershipName}`,
        html: layoutHtml(
          `<p style="color:#e5edff;font-size:15px;line-height:1.6;">${hi}we noticed a change to the insurance on your financed vehicle (${args.summary}). To keep your loan in good standing, we need to confirm your active coverage.</p>
           <p style="color:#9fb0d0;font-size:14px;line-height:1.6;">${action}</p>`,
        ),
        sms: `${args.dealershipName}: we noticed an insurance change (${args.summary}). ${args.intakeUrl ? `Confirm coverage: ${args.intakeUrl}` : "Please reply or call us."} Reply STOP to opt out.`,
      };
    case "REINSTATEMENT_REMINDER":
      return {
        subject: `Coverage confirmed — thank you (${args.dealershipName})`,
        html: layoutHtml(
          `<p style="color:#e5edff;font-size:15px;line-height:1.6;">${hi}we've confirmed your insurance is active again. No further action is needed. Thank you for keeping your coverage current.</p>`,
        ),
        sms: `${args.dealershipName}: your insurance is confirmed active again — thank you. Reply STOP to opt out.`,
      };
    case "COVERAGE_DOWNGRADED":
      return {
        subject: `Important: your coverage was reduced — ${args.dealershipName}`,
        html: layoutHtml(
          `<p style="color:#e5edff;font-size:15px;line-height:1.6;">${hi}your loan agreement requires comprehensive and collision coverage on your vehicle. We detected: ${args.summary}.</p>
           <p style="color:#9fb0d0;font-size:14px;line-height:1.6;">${action} If coverage isn't restored, the lender may add force-placed insurance (typically $1,500–$3,000/yr).</p>`,
        ),
        sms: `${args.dealershipName}: your auto coverage was reduced (${args.summary}). Your loan requires full coverage. ${args.intakeUrl ?? "Please contact us."} Reply STOP to opt out.`,
      };
    case "DEDUCTIBLE_INCREASED":
      return {
        subject: `Notice: your deductible increased — ${args.dealershipName}`,
        html: layoutHtml(
          `<p style="color:#e5edff;font-size:15px;line-height:1.6;">${hi}we detected ${args.summary}. Your loan agreement may cap the maximum deductible allowed.</p>
           <p style="color:#9fb0d0;font-size:14px;line-height:1.6;">${action}</p>`,
        ),
        sms: `${args.dealershipName}: ${args.summary}. Please confirm this meets your loan terms. ${args.intakeUrl ?? ""} Reply STOP to opt out.`,
      };
    case "EXPIRATION_MOVED_UP":
      return {
        subject: `Your policy now expires sooner — ${args.dealershipName}`,
        html: layoutHtml(
          `<p style="color:#e5edff;font-size:15px;line-height:1.6;">${hi}we detected ${args.summary}. Please make sure your coverage stays continuous.</p>
           <p style="color:#9fb0d0;font-size:14px;line-height:1.6;">${action}</p>`,
        ),
        sms: `${args.dealershipName}: ${args.summary}. Keep coverage continuous. ${args.intakeUrl ?? ""} Reply STOP to opt out.`,
      };
  }
}
```

- [ ] **Step 2: Compile + commit**

Run: `cd functions; npm run build`

```bash
git add functions/src/services/cadence-templates.ts
git commit -m "feat: borrower change-notification message templates"
```

---

### Task 3.4: Real `dispatchChangeNotifications` (borrower + lender I/O)

**Files:**
- Modify: `functions/src/services/change-notifications.ts` (replace the stub)

- [ ] **Step 1: Implement** (uses existing senders + consent/quiet-hours guards)

```typescript
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { SmsConsentStatus } from "../types/borrower";
import {
  NotificationType,
  NotificationTrigger,
  NotificationStatus,
  NotificationChannel,
} from "../types/notification";
import { sendSms, isWithinSendingHours } from "./telnyx";
import { changeMessage, type ChangeMessageKind } from "./cadence-templates";
import { sendChangeEmail } from "./email-change"; // thin wrapper, see step 2
import { dispatchLenderChangeAlert } from "./lender-email";
import { decideChangeNotifications } from "./change-notification-policy";
import type { RawPolicyChange } from "./policy-diff";

export interface DispatchChangeInput {
  organizationId: string;
  borrowerId: string;
  policyId: string;
  changeIds: string[];
  changes: RawPolicyChange[];
}

const INTAKE_URL_BASE = "https://app.autolientracker.com/intake";

export async function dispatchChangeNotifications(
  input: DispatchChangeInput,
): Promise<void> {
  const { organizationId, borrowerId, policyId, changes, changeIds } = input;

  const orgSnap = await collections.organizations.doc(organizationId).get();
  const org = orgSnap.data();
  if (!org) return;
  const rules = org.settings?.complianceRules;
  if (rules?.notificationsPaused) return; // org kill-switch
  const dealershipName = org.name ?? "Your Lender";

  const decision = decideChangeNotifications(changes);
  const summary = changes.map((c) => c.summary).join("; ");

  // ── Borrower ──
  if (decision.notifyBorrower && decision.borrowerTrigger && borrowerId) {
    const borrowerSnap = await collections.borrowers.doc(borrowerId).get();
    const borrower = borrowerSnap.data();
    if (borrower) {
      const kind = decision.borrowerTrigger as ChangeMessageKind;
      const intakeUrl =
        kind === "REINSTATEMENT_REMINDER" ? undefined : `${INTAKE_URL_BASE}/${policyId}`;
      const msg = changeMessage(kind, {
        dealershipName,
        firstName: borrower.firstName,
        summary,
        intakeUrl,
      });
      const trigger = mapTrigger(kind);

      // Email (always allowed).
      if (borrower.email) {
        await sendChangeEmail(borrower.email, msg.subject, msg.html).catch((e) =>
          logger.error("change email failed", { policyId, e }),
        );
        await recordNotification(borrowerId, organizationId, NotificationType.EMAIL, NotificationChannel.EMAIL, trigger, msg.subject);
      }
      // SMS (consent + TCPA quiet hours).
      const consented = borrower.smsConsentStatus === SmsConsentStatus.OPTED_IN;
      const tz = rules?.timezone;
      if (consented && borrower.phone && isWithinSendingHours(tz)) {
        await sendSms(borrower.phone, msg.sms).catch((e) =>
          logger.error("change sms failed", { policyId, e }),
        );
        await recordNotification(borrowerId, organizationId, NotificationType.SMS, NotificationChannel.SMS, trigger, msg.sms);
      }
    }
  }

  // ── Lender ──
  if (decision.notifyLender) {
    await dispatchLenderChangeAlert({
      organizationId,
      policyId,
      borrowerId,
      severity: decision.lenderSeverity ?? "warning",
      summary,
    }).catch((e) => logger.error("lender change alert failed", { policyId, e }));
  }

  // Stamp the change docs as notified.
  const batch = db.batch();
  for (const id of changeIds) {
    batch.update(collections.policyChanges.doc(id), {
      notifiedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit().catch(() => undefined);
}

function mapTrigger(kind: ChangeMessageKind): NotificationTrigger {
  switch (kind) {
    case "VERIFICATION_PROOF_REQUEST":
      return NotificationTrigger.VERIFICATION_PROOF_REQUEST;
    case "REINSTATEMENT_REMINDER":
      return NotificationTrigger.REINSTATEMENT_REMINDER;
    case "COVERAGE_DOWNGRADED":
      return NotificationTrigger.COVERAGE_DOWNGRADED;
    case "DEDUCTIBLE_INCREASED":
      return NotificationTrigger.DEDUCTIBLE_INCREASED;
    case "EXPIRATION_MOVED_UP":
      return NotificationTrigger.EXPIRATION_MOVED_UP;
  }
}

async function recordNotification(
  borrowerId: string,
  organizationId: string,
  type: NotificationType,
  channel: NotificationChannel,
  trigger: NotificationTrigger,
  content: string,
): Promise<void> {
  await collections.notifications.add({
    borrowerId,
    organizationId,
    type,
    channel,
    trigger,
    status: NotificationStatus.SENT,
    content,
    sentAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  } as never);
}
```

- [ ] **Step 2: Add the two thin wrappers used above**

If a generic change-email sender doesn't already exist, create `functions/src/services/email-change.ts`:

```typescript
import { sendCadenceEmail } from "./cadence-templates";
// Reuse the existing Resend client the cadence templates use. If cadence-templates
// does not export a generic sender, add one there instead and import it.
export async function sendChangeEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  await sendGenericEmail(to, subject, html);
}
```

> NOTE for the implementer: check [cadence-templates.ts](../../../functions/src/services/cadence-templates.ts) — it already constructs a Resend client (`getResend()`). Prefer adding a small `export async function sendGenericEmail(to, subject, html)` there and importing it, rather than a new file, to keep one Resend client. Adjust the import in `change-notifications.ts` accordingly. Verify by reading the file before implementing.

- [ ] **Step 3: Build**

Run: `cd functions; npm run build`
Expected: errors only for `dispatchLenderChangeAlert` (added in Task 3.5) and the email wrapper until both exist. Implement 3.5 before deploying.

- [ ] **Step 4: Commit (after 3.5 compiles clean)**

```bash
git add functions/src/services/change-notifications.ts functions/src/services/email-change.ts
git commit -m "feat: dispatch change-driven borrower notifications (email + consented SMS)"
```

---

### Task 3.5: Lender change alert

**Files:**
- Modify: `functions/src/services/lender-email.ts`

- [ ] **Step 1: Add `dispatchLenderChangeAlert`** (mirror the existing `dispatchDealerSweepAlert` pattern: find the first ADMIN user's email, send, log a notification)

```typescript
import type { ChangeSeverity } from "../types/policy-change";

export interface LenderChangeAlertInput {
  organizationId: string;
  policyId: string;
  borrowerId: string;
  severity: ChangeSeverity;
  summary: string;
}

/**
 * Real-time lender alert for a material coverage change on a financed vehicle.
 * Sends to the org's admin(s). Severity drives subject prefix.
 */
export async function dispatchLenderChangeAlert(
  input: LenderChangeAlertInput,
): Promise<void> {
  // ... resolve admin email(s) exactly as dispatchDealerSweepAlert does ...
  // ... build a small HTML body with borrower name + input.summary ...
  // ... send via the existing lender email sender ...
  // ... record a lender-facing notification doc if that's the existing pattern ...
}
```

> Implementer: open `lender-email.ts` and `dealer-sweep-alert.ts` first; reuse their admin-lookup + send helpers verbatim. Subject: `critical → "[Action] Coverage change"`, `warning → "Coverage change"`, `info → "Coverage update"`.

- [ ] **Step 2: Build, deploy the trigger (it bundles these services)**

Run: `cd functions; npm run build`
From repo root: `firebase deploy --only functions:onPolicyVerificationChange`
Expected: "Successful update operation".

- [ ] **Step 3: Commit**

```bash
git add functions/src/services/lender-email.ts
git commit -m "feat: real-time lender alert for material coverage changes"
```

---

## Chunk 4: Carrier-switch flow ("no record at carrier" ≠ lapse)

Closes the false-lapse gap: when a sweep finds no policy at the carrier on file, treat it as a possible switch and ask the borrower to confirm/upload new coverage instead of escalating to repo.

### Task 4.1: Classify sweep outcome (pure, tested)

**Files:**
- Create: `functions/src/services/carrier-switch.ts`
- Test: `functions/src/services/carrier-switch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { classifySweepOutcome } from "./carrier-switch";

test("explicit cancelled is a true lapse", () => {
  assert.equal(classifySweepOutcome({ parsedStatus: "CANCELLED", recordFound: true }), "LAPSE");
});

test("no record at carrier with prior active coverage is a possible switch", () => {
  assert.equal(
    classifySweepOutcome({ parsedStatus: "NOT_AVAILABLE", recordFound: false, hadPriorCoverage: true }),
    "POSSIBLE_SWITCH",
  );
});

test("active is OK", () => {
  assert.equal(classifySweepOutcome({ parsedStatus: "ACTIVE", recordFound: true }), "OK");
});

test("no record + no prior coverage stays a lapse (never insured here)", () => {
  assert.equal(
    classifySweepOutcome({ parsedStatus: "NOT_AVAILABLE", recordFound: false, hadPriorCoverage: false }),
    "LAPSE",
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions; npm run build`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
export type SweepOutcome = "OK" | "LAPSE" | "POSSIBLE_SWITCH";

interface ClassifyInput {
  parsedStatus: string;
  /** Did the carrier portal return ANY matching policy record? */
  recordFound: boolean;
  /** Was this policy previously verified as active coverage? */
  hadPriorCoverage?: boolean;
}

const LAPSED = new Set(["CANCELLED", "EXPIRED", "RESCINDED"]);

/**
 * Distinguish a genuine lapse (carrier explicitly says cancelled/expired) from
 * a likely carrier switch (carrier has no record, but the borrower previously
 * had active coverage here — they probably moved to another insurer).
 */
export function classifySweepOutcome(input: ClassifyInput): SweepOutcome {
  if (input.parsedStatus === "ACTIVE") return "OK";
  if (LAPSED.has(input.parsedStatus)) return "LAPSE";
  // NOT_AVAILABLE / no record:
  if (!input.recordFound && input.hadPriorCoverage) return "POSSIBLE_SWITCH";
  return "LAPSE";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions; npm test`
Expected: carrier-switch tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/carrier-switch.ts functions/src/services/carrier-switch.test.ts
git commit -m "feat: classify sweep outcome OK/LAPSE/POSSIBLE_SWITCH"
```

---

### Task 4.2: Apply the switch branch in `recordManualSweepResult`

**Files:**
- Modify: `functions/src/functions/manual-carrier-sweep.ts`

- [ ] **Step 1: Use the classifier in the success path**

In `recordManualSweepResult`, after computing `parsed` and before building `policyUpdate`, classify the outcome. The carrier scrape sets `parsed.status`; "no record found" is represented today by the normalizer returning `NOT_AVAILABLE`. Read whether the policy previously had active coverage via `policy.lastVerifiedAt` + prior `status === ACTIVE` (or `policy.lastSnapshot?.status === "ACTIVE"`).

```typescript
import { classifySweepOutcome } from "../services/carrier-switch";
// ...
const hadPriorCoverage =
  policy.lastSnapshot?.status === PolicyStatus.ACTIVE ||
  policy.status === PolicyStatus.ACTIVE;
const outcome = classifySweepOutcome({
  parsedStatus: parsed.status,
  recordFound: parsed.status !== PolicyStatus.NOT_AVAILABLE,
  hadPriorCoverage,
});

if (outcome === "POSSIBLE_SWITCH") {
  // Do NOT mark a hard lapse. Flag a probable carrier switch so the change
  // trigger fires a "confirm coverage / new carrier?" intake instead of a
  // repo-track lapse cadence.
  policyUpdate.possibleCarrierSwitch = true;
  policyUpdate.carrierSwitchDetectedAt = FieldValue.serverTimestamp();
  // Keep status soft: leave existing status rather than forcing CANCELLED.
  delete policyUpdate.status;
  delete policyUpdate.policyStatus;
  finalDashboardStatus = DashboardStatus.YELLOW;
  policyUpdate.dashboardStatus = finalDashboardStatus;
} else {
  // Normal path: clear any stale switch flag.
  policyUpdate.possibleCarrierSwitch = FieldValue.delete();
  policyUpdate.carrierSwitchDetectedAt = FieldValue.delete();
}
```

> Implementer: place this AFTER `finalComplianceIssues`/`finalDashboardStatus` are computed and BEFORE `webhook*` assignments so the webhook reflects the softened status. Keep `lastVerifiedAt` stamping as-is (the verification did run). The change trigger then sees `possibleCarrierSwitch` + a carrier diff and routes a `VERIFICATION_PROOF_REQUEST` to the borrower.

- [ ] **Step 2: Build + deploy**

Run: `cd functions; npm run build`
From repo root: `firebase deploy --only functions:recordManualSweepResult`
Expected: "Successful update operation".

- [ ] **Step 3: Commit**

```bash
git add functions/src/functions/manual-carrier-sweep.ts
git commit -m "feat: treat 'no record at carrier' as possible switch, not a hard lapse"
```

---

### Task 4.3: Keep the lapse cadence from escalating a suspected switch

**Files:**
- Modify: `functions/src/functions/daily-compliance-escalation.ts`
- Modify: `functions/src/functions/daily-lapse-auto-request.ts`

- [ ] **Step 1: Skip escalation when `possibleCarrierSwitch` is set**

In both daily jobs, inside the per-policy loop, add early-continue:

```typescript
if (policy.possibleCarrierSwitch) continue; // handled by carrier-switch confirm flow
```

Place it right after loading `const policy = policyDoc.data();` (before the lapse/coverage branching).

- [ ] **Step 2: Build + deploy each**

Run: `cd functions; npm run build`
From repo root, individually:
`firebase deploy --only functions:dailyComplianceEscalation`
then `firebase deploy --only functions:dailyLapseAutoRequest`
Expected: each "Successful update operation".

- [ ] **Step 3: Commit**

```bash
git add functions/src/functions/daily-compliance-escalation.ts functions/src/functions/daily-lapse-auto-request.ts
git commit -m "fix: suspected carrier switch is excluded from lapse/repo escalation"
```

---

## Chunk 5: Onboarding compliance hardening

Sets the lender's risk bar correctly at onboarding so downgrades are actually detectable, and sets borrower expectations to report changes.

### Task 5.1: Compliance defaults (pure, tested)

**Files:**
- Create: `functions/src/services/compliance-defaults.ts`
- Test: `functions/src/services/compliance-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { defaultComplianceRules } from "./compliance-defaults";

test("lienholder org types require comprehensive + collision by default", () => {
  const r = defaultComplianceRules("BHPH_DEALER");
  assert.equal(r.requireComprehensive, true);
  assert.equal(r.requireCollision, true);
  assert.equal(r.requireLienholder, true);
});

test("defaults include sane deductible caps and warning windows", () => {
  const r = defaultComplianceRules("BANK");
  assert.equal(typeof r.maxCompDeductible, "number");
  assert.ok(r.expirationWarningDays >= 7);
  assert.ok(r.lapseGracePeriodDays >= 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions; npm run build`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (match the existing `ComplianceRules` shape in `organization.ts`)

```typescript
import type { ComplianceRules } from "../types/organization";

/**
 * Opinionated defaults applied when an org completes onboarding without
 * explicit compliance rules. All lender/lienholder org types require full
 * physical-damage coverage so a comprehensive→liability downgrade is
 * detectable. Caps are conservative ($1,000) and overridable in Settings.
 */
export function defaultComplianceRules(_orgType: string): ComplianceRules {
  return {
    requireLienholder: true,
    requireComprehensive: true,
    requireCollision: true,
    maxCompDeductible: 1000,
    maxCollisionDeductible: 1000,
    expirationWarningDays: 14,
    lapseGracePeriodDays: 10,
    autoSendReminder: true,
    reminderDaysBeforeExpiry: 14,
  };
}
```

> Implementer: confirm field names against `ComplianceRules` in [organization.ts](../../../functions/src/types/organization.ts); add any required fields (e.g. `lapseEscalation`/`coverageEscalation`) if the type marks them non-optional, using the exported `DEFAULT_LAPSE_ESCALATION` / `DEFAULT_COVERAGE_ESCALATION`.

- [ ] **Step 4: Run to verify pass**

Run: `cd functions; npm test`
Expected: defaults tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/compliance-defaults.ts functions/src/services/compliance-defaults.test.ts
git commit -m "feat: default compliance rules require full coverage for lienholder orgs"
```

---

### Task 5.2: Apply defaults when onboarding completes

**Files:**
- Modify: the org onboarding-complete write path (find it: search for `onboardingCompleted` writes — likely `functions/src/functions/onboarding-kickoff.ts` or an org settings callable).

- [ ] **Step 1: Locate the write**

Run a search to find where `onboardingCompleted` is set true and where `complianceRules` is first written.

```
grep: onboardingCompleted|complianceRules
```

- [ ] **Step 2: Apply defaults only when unset**

In that handler, before writing settings:

```typescript
import { defaultComplianceRules } from "../services/compliance-defaults";
// ...
if (!org.settings?.complianceRules) {
  updates["settings.complianceRules"] = defaultComplianceRules(org.type);
}
```

- [ ] **Step 3: Build + deploy the affected callable**

Run: `cd functions; npm run build`
From repo root: `firebase deploy --only functions:<thatCallable>`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add functions/src/functions/<thatCallable>.ts
git commit -m "feat: seed compliance defaults on onboarding when unset"
```

---

### Task 5.3: Borrower "notify us on any change" acknowledgment (frontend)

**Files:**
- Modify: `frontend/src/components/add-borrower-dialog.tsx`
- Modify: `frontend/src/components/onboarding-wizard.tsx`

- [ ] **Step 1: Add the consent copy + checkbox in add-borrower**

Near the SMS-consent control, add a short acknowledgment the dealer confirms they disclosed to the borrower:

```tsx
<label className="flex items-start gap-2 text-xs text-muted-foreground">
  <Checkbox checked={changeAck} onCheckedChange={(v) => setChangeAck(!!v)} />
  <span>
    Borrower was told they must notify us if they change, downgrade, or cancel
    their insurance, and to keep comprehensive &amp; collision coverage for the
    life of the loan.
  </span>
</label>
```

Persist it onto the created policy as `policyChangeNoticeAck: changeAck` (thread it through the ingest call data).

- [ ] **Step 2: Surface comp/collision/deductible defaults in the onboarding wizard compliance step**

In `onboarding-wizard.tsx`, ensure the compliance step renders `requireComprehensive`, `requireCollision`, `maxCompDeductible`, `maxCollisionDeductible` controls, pre-checked ON (reading the defaults). Add a one-line helper note: "We recommend keeping these on so coverage downgrades are detected automatically."

- [ ] **Step 3: Build the frontend**

Run: `cd frontend; npm run build`
Expected: compiles, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/add-borrower-dialog.tsx frontend/src/components/onboarding-wizard.tsx
git commit -m "feat: borrower change-notice acknowledgment + onboarding coverage defaults UI"
```

---

## Chunk 6: Lender change digest + webhook + support timeline

Gives lenders the recurring "what changed this week" view, adds change context to the partner webhook, and surfaces the change history in the support drawer.

### Task 6.1: Extend the outbound webhook payload

**Files:**
- Modify: `functions/src/services/outbound-webhook.ts`

- [ ] **Step 1: Add fields to `PolicyStatusWebhookPayload`**

```typescript
  /** Set on the verification that detected mid-term changes. */
  changeTypes?: string[];
  changeSummary?: string | null;
```

- [ ] **Step 2: Populate from the change trigger**

In `on-policy-verification-change.ts`, after persisting changes, when dispatching the webhook for this policy include `changeTypes` + `changeSummary`. (If the webhook is only dispatched in `recordManualSweepResult`, pass the change data through there instead, or add a webhook dispatch in the trigger guarded to changes-only to avoid double-sends — prefer enriching the existing dispatch in `recordManualSweepResult` by reading the freshly-written `policyChanges` is overkill; simplest is to add the optional fields and leave them undefined unless the trigger path dispatches. Implementer: pick the single existing dispatch site and thread the fields.)

- [ ] **Step 3: Build + deploy the dispatching function**

Run: `cd functions; npm run build`
From repo root: `firebase deploy --only functions:recordManualSweepResult`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add functions/src/services/outbound-webhook.ts functions/src/functions/on-policy-verification-change.ts
git commit -m "feat: include change types/summary in outbound status webhook"
```

---

### Task 6.2: Weekly lender change digest

**Files:**
- Create: `functions/src/functions/weekly-lender-change-digest.ts`
- Modify: `functions/src/services/lender-email.ts` (add `sendLenderChangeDigestEmail`)
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Implement the scheduled digest**

```typescript
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { DEMO_ORG_ID } from "../constants";
import { sendLenderChangeDigestEmail } from "../services/lender-email";

/**
 * Weekly per-org digest of policy changes (Mon 7:30am CT). Summarizes the past
 * 7 days of policyChanges into a single email to org admins: counts by type +
 * the affected borrowers.
 */
export const weeklyLenderChangeDigest = onSchedule(
  {
    schedule: "30 7 * * 1",
    timeZone: "America/Chicago",
    retryCount: 1,
    memory: "256MiB",
  },
  async () => {
    const since = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const orgsSnap = await collections.organizations.get();

    for (const orgDoc of orgsSnap.docs) {
      if (orgDoc.id === DEMO_ORG_ID) continue;
      const changesSnap = await collections.policyChanges
        .where("organizationId", "==", orgDoc.id)
        .where("createdAt", ">=", since)
        .orderBy("createdAt", "desc")
        .get();
      if (changesSnap.empty) continue;

      const counts: Record<string, number> = {};
      const rows: { summary: string; borrowerId: string }[] = [];
      for (const d of changesSnap.docs) {
        const c = d.data();
        counts[c.type] = (counts[c.type] ?? 0) + 1;
        rows.push({ summary: c.summary, borrowerId: c.borrowerId });
      }

      await sendLenderChangeDigestEmail({
        organizationId: orgDoc.id,
        orgName: orgDoc.data().name ?? "Your portfolio",
        counts,
        rows,
      }).catch((e) =>
        logger.error("change digest failed", { org: orgDoc.id, e }),
      );
    }
  },
);
```

- [ ] **Step 2: Add `sendLenderChangeDigestEmail`** in `lender-email.ts` (reuse admin-lookup + Resend client; render counts table + up to ~25 rows).

- [ ] **Step 3: Export + build + deploy**

In `index.ts`: `export { weeklyLenderChangeDigest } from "./functions/weekly-lender-change-digest";`

Run: `cd functions; npm run build`
From repo root: `firebase deploy --only functions:weeklyLenderChangeDigest`
Expected: "Successful create operation".

- [ ] **Step 4: Commit**

```bash
git add functions/src/functions/weekly-lender-change-digest.ts functions/src/services/lender-email.ts functions/src/index.ts
git commit -m "feat: weekly lender change digest email"
```

---

### Task 6.3: Change timeline in the support drawer

**Files:**
- Create callable: `functions/src/functions/admin-policy-changes.ts` (`getPolicyChanges({ organizationId, policyId })`, `requireSuperAdmin`)
- Modify: `functions/src/index.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/admin-borrower-support.tsx`

- [ ] **Step 1: Callable returns recent changes for a policy**

```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { requireSuperAdmin } from "../middleware/auth";

export const getPolicyChanges = onCall(
  { region: "us-central1", memory: "256MiB" },
  async (request) => {
    requireSuperAdmin(request);
    const { organizationId, policyId } = (request.data ?? {}) as {
      organizationId?: string;
      policyId?: string;
    };
    if (!organizationId || !policyId) {
      throw new HttpsError("invalid-argument", "organizationId and policyId required");
    }
    const snap = await collections.policyChanges
      .where("policyId", "==", policyId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();
    const changes = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .filter((c) => c.organizationId === organizationId)
      .map((c) => ({
        id: c.id as string,
        type: c.type as string,
        severity: c.severity as string,
        summary: c.summary as string,
        createdAtMs:
          (c.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0,
      }));
    return { changes };
  },
);
```

- [ ] **Step 2: Export, build, deploy**

`index.ts`: `export { getPolicyChanges } from "./functions/admin-policy-changes";`
Run: `cd functions; npm run build`
From repo root: `firebase deploy --only functions:getPolicyChanges`

- [ ] **Step 3: Frontend wrapper + render**

In `api.ts` add `callGetPolicyChanges({ organizationId, policyId })` + a `PolicyChangeRow` type. In `admin-borrower-support.tsx`, per policy, load changes and render a small timeline (severity dot + summary + relative date), newest first.

- [ ] **Step 4: Build frontend + commit**

Run: `cd frontend; npm run build`

```bash
git add functions/src/functions/admin-policy-changes.ts functions/src/index.ts frontend/src/lib/api.ts frontend/src/components/admin-borrower-support.tsx
git commit -m "feat: policy change timeline in admin borrower support drawer"
```

---

## Final verification & push

- [ ] **Run the whole test suite**

Run: `cd functions; npm test`
Expected: all new suites pass (coverage-extract, policy-snapshot, policy-diff, change-notification-policy, carrier-switch, compliance-defaults) plus existing suites green.

- [ ] **Confirm all functions built + deployed**

`onPolicyVerificationChange`, `recordManualSweepResult` (updated), `dailyComplianceEscalation` (updated), `dailyLapseAutoRequest` (updated), `weeklyLenderChangeDigest`, `getPolicyChanges`. Firestore indexes deployed.

- [ ] **Push**

```bash
git push origin main
```
(Exit code 1 with `oldsha..newsha main -> main` in stderr = SUCCESS.)

---

## Coverage matrix — what this plan delivers

| Lifecycle event | Detected | Borrower | Lender | Mechanism |
|---|---|---|---|---|
| Cancels policy (explicit) | ✅ real-time on sweep | Lapse cadence (existing) | Real-time alert + digest | diff `POLICY_LAPSED` + existing cadence |
| Switches carriers | ✅ NEW | "Confirm coverage" proof request | Real-time alert + digest | `CARRIER_CHANGED` / `POSSIBLE_SWITCH` branch |
| Deductible increased | ✅ NEW (delta, not just threshold) | Notice + confirm | Real-time alert + digest | `DEDUCTIBLE_INCREASED` |
| Comprehensive → liability | ✅ NEW | Critical notice + proof request | Real-time alert + digest | `COVERAGE_DOWNGRADED` |
| Expiration moved earlier | ✅ NEW | Notice | Digest | `EXPIRATION_MOVED_UP` |
| Lienholder removed | ✅ NEW (as change) | Proof request | Real-time alert + digest | `LIENHOLDER_REMOVED` |
| Reinstated after lapse | ✅ NEW | Confirmation | (status clears) | `POLICY_REINSTATED` + `REINSTATEMENT_REMINDER` |
| Any dashboardStatus transition | ✅ NEW audit | — | Audit log | trigger writes auditLog |

---

## Out of scope (explicitly)

- Real-time (sub-day) carrier polling — economics unchanged; detection remains at sweep cadence.
- Actual force-placed insurance / CPI execution or formal compliance-letter generation (legal function; system still only warns).
- Multi-vehicle-per-policy granularity for partial vehicle removal (existing `VEHICLE_REMOVED` issue still applies).
