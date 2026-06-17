# AutoLien Tracker — Partner Integration Guide

Integrate your DMS, CRM, or dealer platform with AutoLien Tracker so funded
deals flow in automatically and insurance verification status flows back —
no manual data entry for dealership staff.

Full API reference: [openapi.yaml](./openapi.yaml)

## How it works

```
Your platform                    AutoLien Tracker
─────────────                    ────────────────
Deal funded ──POST /v1/deals──▶  Borrower + vehicle + policy created
                                 Borrower intake (SMS/email) sent if
                                 insurance details are missing
                                 Insurance verified against carrier
◀──signed webhook────────────────  Verification status recorded
   policy.verification.updated
```

## 1. Get credentials

AutoLien issues you, per dealership:

- An **API key** (`alt_live_…`) — authenticates your requests.
- A **webhook secret** (optional) — verifies status callbacks we send you.

Keys are scoped to one dealership. A multi-dealer integration uses one key per
dealership; key management for partners with many dealers is coordinated with
AutoLien during onboarding.

### Test mode (sandbox keys)

Alongside your live key you can request a **test key** (`alt_test_…`). Test keys
hit the same endpoints and return the same response shapes, but run in dry-run:

- `POST /v1/deals` validates your payload (you still get real `422` errors) but
  **persists nothing** and triggers **no SMS, no webhook, no verification**. The
  response echoes synthetic `test_…` IDs and `"mode": "test"`.
- `GET /v1/deals/{policyId}` returns a synthetic `ACTIVE`/`GREEN` sample for any
  `test_…` policyId.

Use test keys to build and CI your integration without touching production
borrowers. Switch to your `alt_live_` key when you're ready to go live.

## 2. Push a deal

```
POST https://api.autolientracker.com/v1/deals
Authorization: Bearer alt_live_xxxxxxxx
Idempotency-Key: deal-48213-attempt-1
Content-Type: application/json

{
  "borrower": {
    "firstName": "Jane",
    "lastName": "Driver",
    "phone": "+15155550123",
    "email": "jane@example.com",
    "loanNumber": "LN-48213",
    "smsConsent": true
  },
  "vehicle": { "vin": "1FMCU9GD8HUB90368", "make": "Ford", "model": "Escape", "year": 2017 },
  "insurance": { "provider": "Progressive", "policyNumber": "875204209" }
}
```

Response (`201`):

```json
{
  "policyId": "abc123",
  "borrowerId": "def456",
  "vehicleId": "ghi789",
  "isNewBorrower": true,
  "intakeRequested": false
}
```

Notes:

- `insurance` is optional. Without it, AutoLien automatically texts/emails the
  borrower a secure intake link to collect their insurance details
  (`intakeRequested: true`).
- Retries are safe: send an `Idempotency-Key`, and borrowers also deduplicate
  by `loanNumber`, vehicles by VIN.
- Keep `policyId` — it's the correlation ID for status reads and webhooks.

## 3. Receive status updates (webhook)

When a verification result is recorded you receive:

```
POST <your webhook URL>
X-AutoLien-Timestamp: 1781300000
X-AutoLien-Signature: v1=4f1d…
Content-Type: application/json

{
  "event": "policy.verification.updated",
  "policyId": "abc123",
  "loanNumber": "LN-48213",
  "status": "ACTIVE",
  "dashboardStatus": "GREEN",
  "complianceIssues": [],
  "isLienholderListed": true,
  "lastVerifiedAt": "2026-06-12T18:30:00.000Z",
  "lastVerificationError": null,
  "verifiedVia": "manual-operator",
  "sentAt": "2026-06-12T18:30:01.000Z"
}
```

### Verifying the signature

1. Read `X-AutoLien-Timestamp` (unix seconds) and the raw request body.
2. Compute `HMAC_SHA256(secret, "<timestamp>.<rawBody>")` as lowercase hex.
3. Compare (constant-time) against the `v1=` value in `X-AutoLien-Signature`.
4. Reject if the timestamp is older than 300 seconds (replay protection).

Node.js example:

```js
const crypto = require("crypto");

function verify(req, secret) {
  const ts = req.get("X-AutoLien-Timestamp");
  const sig = (req.get("X-AutoLien-Signature") || "").replace(/^v1=/, "");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${req.rawBody}`)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
```

Respond with any 2xx within 10 seconds. Delivery is retried up to 3 times with
backoff (immediately, then +2s, +8s) on non-2xx responses or network errors;
the final outcome is recorded. It remains best-effort, so also poll if you need
guaranteed consistency.

### Inspecting deliveries

```
GET /v1/webhooks/deliveries
Authorization: Bearer alt_live_xxxxxxxx
```

Returns your 50 most recent webhook deliveries (org-scoped):

```json
{
  "deliveries": [
    {
      "policyId": "abc123",
      "event": "policy.verification.updated",
      "finalStatus": 200,
      "attempts": 1,
      "createdAt": "2026-06-12T18:30:01.000Z",
      "lastError": null
    }
  ]
}
```

## 4. Poll status (alternative to webhooks)

```
GET /v1/deals/{policyId}
Authorization: Bearer alt_live_xxxxxxxx
```

Returns the same fields as the webhook payload (see `DealStatus` in the
OpenAPI spec).

## Errors

All errors are JSON: `{ "error": { "code": "...", "message": "..." } }`

| HTTP | code               | meaning                                  |
|------|--------------------|------------------------------------------|
| 401  | unauthorized       | missing / invalid / revoked API key      |
| 404  | not_found          | unknown endpoint or policy               |
| 405  | method_not_allowed | wrong HTTP verb                          |
| 413  | invalid_request    | request body exceeds the size limit      |
| 422  | invalid_request    | payload failed validation                |
| 429  | rate_limited       | too many requests — honor `Retry-After`  |
| 500  | internal           | our fault — retry with the same Idempotency-Key |

## Minimum data contract

| Field                  | Required | Notes                              |
|------------------------|----------|------------------------------------|
| borrower.firstName/lastName | yes | —                                  |
| borrower.email or phone | yes (≥1)| phone enables SMS intake           |
| borrower.loanNumber    | recommended | your deal ID; enables dedupe + correlation |
| vehicle.vin            | yes      | drives carrier verification        |
| insurance.provider/policyNumber | no | skips borrower intake when present |
