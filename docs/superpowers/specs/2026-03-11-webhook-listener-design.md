# Phase 4: Webhook Listener & Status Monitoring — Design Spec

## Overview

MeasureOne sends webhook events when insurance verification data is ready or updated. This phase builds the HTTP endpoint to receive those events, parse insurance records, update policy status, and compute dashboard status (GREEN/YELLOW/RED).

## Architecture

One HTTP Cloud Function (`measureOneWebhook`) receives POST requests from MeasureOne. Unlike the Phase 2-3 callable functions, this uses `onRequest` (not `onCall`) since webhooks come from an external service, not authenticated Firebase clients. Security is enforced via a shared secret header.

## Webhook Events Handled

| Event | Meaning | Action |
|-------|---------|--------|
| `datarequest.report_complete` | First insurance report ready | Fetch insurance details, update policy |
| `datarequest.report_update_available` | Policy data refreshed/changed | Fetch insurance details, update policy |
| `datarequest.report_error` | Verification failed | Set policy RED, status NOT_AVAILABLE |

## Webhook Payload (MeasureOne)

```json
{
  "event": "datarequest.report_complete",
  "datarequest_id": "dr_abc123"
}
```

## Security

- Verify `x-webhook-secret` header matches `MEASUREONE_WEBHOOK_SECRET` env var
- Reject with 401 if mismatch
- Return 200 immediately after validation to avoid timeouts

## Processing Flow

1. Receive POST → validate secret
2. Extract `event` and `datarequest_id`
3. Look up policy by `measureOneDataRequestId`
4. If `report_complete` or `report_update_available`:
   - Call `getInsuranceDetails({ datarequest_id })`
   - Parse M1_INSURANCE_RECORD from response
   - Map status to PolicyStatus enum
   - Check `policy_holders` for LIEN_HOLDER
   - Extract coveragePeriod, coverages, policyNumber, insuranceProvider
   - Compute dashboardStatus
   - Update policy document
   - Audit log
5. If `report_error`:
   - Set status=NOT_AVAILABLE, dashboardStatus=RED
   - Audit log

## Dashboard Status Computation

```
if (status === ACTIVE && isLienholderListed) → GREEN
if (status === PENDING_EXPIRATION || expiringWithin15Days) → YELLOW
else → RED (EXPIRED, CANCELLED, RESCINDED, no lienholder, NOT_AVAILABLE, etc.)
```

## Files

- **Create:** `functions/src/functions/measure-one-webhook.ts` — webhook handler
- **Create:** `functions/src/services/insurance-parser.ts` — M1_INSURANCE_RECORD → Policy mapping
- **Modify:** `functions/src/index.ts` — add Phase 4 export
- **Modify:** `frontend/src/lib/api.ts` — no changes needed (webhook is server-to-server)
