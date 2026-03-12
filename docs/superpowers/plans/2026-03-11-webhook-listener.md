# Phase 4: Webhook Listener & Status Monitoring — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MeasureOne webhook endpoint that receives insurance verification events, parses insurance records, updates policy status, and computes dashboard status (GREEN/YELLOW/RED).

**Architecture:** One HTTP Cloud Function (`measureOneWebhook`) using `onRequest` for external webhook delivery. A separate insurance parser module handles M1_INSURANCE_RECORD → Policy field mapping and dashboard status computation. Security via shared secret header.

**Tech Stack:** Firebase Cloud Functions v2 (onRequest), TypeScript, MeasureOne API, Firestore

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `functions/src/services/insurance-parser.ts` | Parse M1_INSURANCE_RECORD, map to Policy fields, compute dashboardStatus |
| Create | `functions/src/functions/measure-one-webhook.ts` | HTTP webhook handler: validate secret, route events, call parser, update Firestore |
| Modify | `functions/src/index.ts` | Add Phase 4 export |

---

## Chunk 1: Insurance Parser Service

### Task 1: Create insurance-parser.ts

**Files:**
- Create: `functions/src/services/insurance-parser.ts`

- [ ] **Step 1: Create the insurance parser module**

This module exports two things:
1. `parseInsuranceRecord(record: unknown)` — extracts policy fields from a MeasureOne M1_INSURANCE_RECORD
2. `computeDashboardStatus(status, isLienholderListed, coveragePeriod)` — returns GREEN/YELLOW/RED

```typescript
// functions/src/services/insurance-parser.ts
import { PolicyStatus, DashboardStatus } from "../types/policy";
import type { CoveragePeriod, Coverage } from "../types/policy";

interface ParsedInsuranceRecord {
  status: PolicyStatus;
  policyNumber: string | undefined;
  policyTypes: string[];
  coveragePeriod: CoveragePeriod | undefined;
  coverages: Coverage[];
  isLienholderListed: boolean;
  insuranceProvider: string | undefined;
}

/**
 * Maps MeasureOne status string to our PolicyStatus enum.
 * Unknown statuses default to NOT_AVAILABLE.
 */
function mapStatus(m1Status: string): PolicyStatus {
  const mapping: Record<string, PolicyStatus> = {
    ACTIVE: PolicyStatus.ACTIVE,
    EXPIRED: PolicyStatus.EXPIRED,
    PENDING_ACTIVATION: PolicyStatus.PENDING_ACTIVATION,
    PENDING_CANCELLATION: PolicyStatus.PENDING_CANCELLATION,
    PENDING_EXPIRATION: PolicyStatus.PENDING_EXPIRATION,
    CANCELLED: PolicyStatus.CANCELLED,
    UNVERIFIED: PolicyStatus.UNVERIFIED,
    RESCINDED: PolicyStatus.RESCINDED,
    NOT_AVAILABLE: PolicyStatus.NOT_AVAILABLE,
  };
  return mapping[m1Status] ?? PolicyStatus.NOT_AVAILABLE;
}

/**
 * Parses a MeasureOne M1_INSURANCE_RECORD into our policy fields.
 */
export function parseInsuranceRecord(record: unknown): ParsedInsuranceRecord {
  const rec = record as Record<string, unknown>;

  const status = mapStatus((rec.status as string) ?? "NOT_AVAILABLE");

  const policyNumber = (rec.policy_number as string) ?? undefined;

  const policyTypes = Array.isArray(rec.policy_types)
    ? (rec.policy_types as string[])
    : [];

  let coveragePeriod: CoveragePeriod | undefined;
  const cp = rec.coverage_period as Record<string, string> | undefined;
  if (cp?.start_date && cp?.end_date) {
    coveragePeriod = {
      startDate: cp.start_date,
      endDate: cp.end_date,
    };
  }

  const coverages: Coverage[] = Array.isArray(rec.coverages)
    ? (rec.coverages as Record<string, unknown>[]).map((c) => ({
        type: (c.type as string) ?? "UNKNOWN",
        limit: c.limit as number | undefined,
        deductible: c.deductible as number | undefined,
      }))
    : [];

  const policyHolders = Array.isArray(rec.policy_holders)
    ? (rec.policy_holders as Record<string, unknown>[])
    : [];
  const isLienholderListed = policyHolders.some(
    (ph) => ph.type === "LIEN_HOLDER"
  );

  const insuranceProvider =
    (rec.insurance_provider as string) ??
    (rec.insurer_name as string) ??
    undefined;

  return {
    status,
    policyNumber,
    policyTypes,
    coveragePeriod,
    coverages,
    isLienholderListed,
    insuranceProvider,
  };
}

/**
 * Computes dashboard stoplight status.
 * GREEN: ACTIVE + lienholder listed
 * YELLOW: PENDING_EXPIRATION or expiring within 15 days
 * RED: everything else
 */
export function computeDashboardStatus(
  status: PolicyStatus,
  isLienholderListed: boolean,
  coveragePeriod?: CoveragePeriod
): DashboardStatus {
  // RED cases: not active, or active but no lienholder
  if (status === PolicyStatus.ACTIVE && isLienholderListed) {
    // Check if expiring within 15 days
    if (coveragePeriod?.endDate) {
      const endDate = new Date(coveragePeriod.endDate);
      const now = new Date();
      const daysUntilExpiry =
        (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntilExpiry <= 15 && daysUntilExpiry > 0) {
        return DashboardStatus.YELLOW;
      }
    }
    return DashboardStatus.GREEN;
  }

  if (status === PolicyStatus.PENDING_EXPIRATION) {
    return DashboardStatus.YELLOW;
  }

  if (status === PolicyStatus.PENDING_ACTIVATION) {
    return DashboardStatus.YELLOW;
  }

  return DashboardStatus.RED;
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd functions && npm run build 2>&1`
Expected: Clean compilation, exit code 0

- [ ] **Step 3: Commit**

```bash
git add functions/src/services/insurance-parser.ts
git commit -m "feat(phase4): add insurance record parser and dashboard status computation"
```

---

## Chunk 2: Webhook Cloud Function

### Task 2: Create measure-one-webhook.ts

**Files:**
- Create: `functions/src/functions/measure-one-webhook.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Create the webhook handler**

```typescript
// functions/src/functions/measure-one-webhook.ts
import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { logAudit } from "../services/audit";
import { measureOneClient } from "../services/measureone";
import { parseInsuranceRecord, computeDashboardStatus } from "../services/insurance-parser";
import { PolicyStatus, DashboardStatus } from "../types/policy";
import { AuditAction, AuditEntityType } from "../types/audit";

const webhookSecret = defineString("MEASUREONE_WEBHOOK_SECRET");

export const measureOneWebhook = onRequest(async (req, res) => {
  // Only accept POST
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // Validate webhook secret
  const receivedSecret = req.headers["x-webhook-secret"] as string | undefined;
  if (!receivedSecret || receivedSecret !== webhookSecret.value()) {
    res.status(401).send("Unauthorized");
    return;
  }

  const { event, datarequest_id } = req.body as {
    event?: string;
    datarequest_id?: string;
  };

  if (!event || !datarequest_id) {
    res.status(400).send("Missing event or datarequest_id");
    return;
  }

  // Look up policy by measureOneDataRequestId
  const policySnap = await collections.policies
    .where("measureOneDataRequestId", "==", datarequest_id)
    .limit(1)
    .get();

  if (policySnap.empty) {
    // No matching policy — acknowledge but skip processing
    res.status(200).json({ status: "ignored", reason: "no matching policy" });
    return;
  }

  const policyDoc = policySnap.docs[0];
  const policy = policyDoc.data();
  const now = Timestamp.now();

  if (event === "datarequest.report_error") {
    // Mark policy as failed
    await collections.policies.doc(policyDoc.id).update({
      status: PolicyStatus.NOT_AVAILABLE,
      dashboardStatus: DashboardStatus.RED,
      lastVerifiedAt: now,
      updatedAt: now,
    });

    await logAudit({
      organizationId: policy.organizationId,
      entityType: AuditEntityType.POLICY,
      entityId: policyDoc.id,
      action: AuditAction.STATUS_CHANGED,
      performedBy: "system:webhook",
      previousValue: {
        status: policy.status,
        dashboardStatus: policy.dashboardStatus,
      },
      newValue: {
        status: PolicyStatus.NOT_AVAILABLE,
        dashboardStatus: DashboardStatus.RED,
        event,
      },
    });

    res.status(200).json({ status: "processed", event });
    return;
  }

  if (
    event === "datarequest.report_complete" ||
    event === "datarequest.report_update_available"
  ) {
    // Fetch insurance details from MeasureOne
    const details = await measureOneClient.getInsuranceDetails({
      datarequest_id,
    });

    if (!details.records || details.records.length === 0) {
      res.status(200).json({ status: "processed", event, records: 0 });
      return;
    }

    // Parse the first insurance record
    const parsed = parseInsuranceRecord(details.records[0]);
    const dashboardStatus = computeDashboardStatus(
      parsed.status,
      parsed.isLienholderListed,
      parsed.coveragePeriod
    );

    const previousValue = {
      status: policy.status,
      dashboardStatus: policy.dashboardStatus,
    };

    // Update policy with parsed insurance data
    await collections.policies.doc(policyDoc.id).update({
      status: parsed.status,
      policyNumber: parsed.policyNumber ?? null,
      policyTypes: parsed.policyTypes,
      coveragePeriod: parsed.coveragePeriod ?? null,
      coverages: parsed.coverages,
      isLienholderListed: parsed.isLienholderListed,
      insuranceProvider: parsed.insuranceProvider ?? null,
      dashboardStatus,
      lastVerifiedAt: now,
      updatedAt: now,
    });

    await logAudit({
      organizationId: policy.organizationId,
      entityType: AuditEntityType.POLICY,
      entityId: policyDoc.id,
      action:
        event === "datarequest.report_complete"
          ? AuditAction.VERIFICATION_COMPLETED
          : AuditAction.STATUS_CHANGED,
      performedBy: "system:webhook",
      previousValue,
      newValue: {
        status: parsed.status,
        dashboardStatus,
        policyNumber: parsed.policyNumber,
        isLienholderListed: parsed.isLienholderListed,
        event,
      },
    });

    res.status(200).json({ status: "processed", event, dashboardStatus });
    return;
  }

  // Unknown event — acknowledge
  res.status(200).json({ status: "ignored", reason: "unknown event" });
});
```

- [ ] **Step 2: Add Phase 4 export to index.ts**

Add to `functions/src/index.ts`:
```typescript
// Phase 4: Webhook Listener & Status Monitoring
export { measureOneWebhook } from "./functions/measure-one-webhook";
```

- [ ] **Step 3: Build to verify compilation**

Run: `cd functions && npm run build 2>&1`
Expected: Clean compilation, exit code 0

- [ ] **Step 4: Commit**

```bash
git add functions/src/functions/measure-one-webhook.ts functions/src/index.ts
git commit -m "feat(phase4): add MeasureOne webhook listener with status monitoring"
```

---

## Chunk 3: Firestore Index

### Task 3: Add composite index for measureOneDataRequestId lookup

**Files:**
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Add index for webhook policy lookup**

The webhook looks up policies by `measureOneDataRequestId`. Add a single-field index if needed, or verify the query works without a composite index (single equality on one field doesn't need composite).

Since the webhook query is `where("measureOneDataRequestId", "==", datarequest_id).limit(1)`, this is a single-field equality query — Firestore automatically indexes all fields. No composite index needed.

- [ ] **Step 2: Final build verification**

Run: `cd functions && npm run build 2>&1`
Expected: Clean compilation, exit code 0

- [ ] **Step 3: Final commit**

```bash
git commit -m "feat(phase4): webhook listener and status monitoring complete"
```
