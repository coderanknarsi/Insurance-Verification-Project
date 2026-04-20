# Carrier Onboarding & Verification Guide

## Architecture Overview

The verification engine automates insurance verification by logging into carrier portals, searching for policies, and extracting coverage data.

```
Dashboard (Next.js) → Cloud Functions (Firebase) → Engine (Express/Playwright/Gemini)
     ↓                        ↓                          ↓
  Save creds           Encrypt & store            Decrypt, login, search, extract
  (Settings UI)        (Firestore)                (Carrier portal via SmartProxy)
```

## Saving Carrier Credentials

1. Go to **https://app.autolientracker.com**
2. Sign in as an **org admin**
3. Navigate to **Settings** tab
4. Scroll to **Carrier Credentials** section
5. Click **Add Carrier** → select carrier → enter portal username/password → **Save**
6. Credentials are encrypted with AES-256-GCM before storage

Firestore path: `organizations/{orgId}/carrierCredentials/{carrierId}`

## Required Secrets & Environment Variables

### Cloud Functions
| Secret | Purpose |
|--------|---------|
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM credential encryption |

Set via: `firebase functions:secrets:set CREDENTIAL_ENCRYPTION_KEY`

### Engine (.env)
| Variable | Purpose |
|----------|---------|
| `SMARTPROXY_USER` | SmartProxy residential proxy username |
| `SMARTPROXY_PASS` | SmartProxy residential proxy password |
| `GOOGLE_AI_API_KEY` | Gemini Flash API key for agent reasoning |
| `CAPSOLVER_API_KEY` | CapSolver API key for CAPTCHA solving |
| `GCP_PROJECT_ID` | Firebase/GCP project ID for Firestore access |
| `IMAP_USER` | Gmail address for reading OTP emails |
| `IMAP_APP_PASSWORD` | Google App Password for IMAP access |
| `CREDENTIAL_ENCRYPTION_KEY` | Same AES-256-GCM key as functions |
| `PORT` | Server port (default 8080, auto-set by Cloud Run) |

## Running a Smoke Test

### Local (bypasses Firestore — for development only)

```bash
cd engine
npx tsc && node dist/index.js
```

Then POST to `/verify-test`:
```json
POST http://localhost:8080/verify-test
{
  "carrier": "progressive",
  "vin": "1HGCM82633A004352",
  "credentials": {
    "username": "autoLT",
    "password": "YOUR_PASSWORD"
  }
}
```

### Production (reads encrypted credentials from Firestore)

```json
POST https://ENGINE_URL/verify
{
  "batchId": "test-001",
  "runId": "run-001",
  "carrier": "progressive",
  "policies": [{
    "policyId": "policy-001",
    "organizationId": "YOUR_ORG_ID",
    "borrowerId": "borrower-001",
    "vehicleId": "vehicle-001",
    "vin": "1HGCM82633A004352",
    "borrowerLastName": "Smith",
    "insuranceProvider": "progressive"
  }]
}
```

## Checking Logs When Verification Fails

1. **Login failure**: Check `[verify]` or `[verify-test]` logs for "Login failed". Usually means credentials are wrong or portal layout changed.
2. **MFA failure**: Check `[agent] Fetching MFA code` and `[otp-reader]` logs. Ensure IMAP credentials are valid and the OTP sender address matches.
3. **Search failure**: Check for "Search/extraction failed". Could be portal layout drift or VIN not found.
4. **Firestore errors**: Check for "RAPT" errors — indicates local ADC is blocked. Use the dashboard UI or deploy to Cloud Run instead.

## Adding a New Carrier

1. Create `engine/src/carriers/{carrier-id}/module.ts` implementing `CarrierModule`
2. Create `engine/src/carriers/{carrier-id}/prompts.ts` with portal-specific context
3. Register the module in `engine/src/carriers/registry.ts`
4. Add OTP sender address in `engine/src/email/otp-reader.ts` (`OTP_SENDERS` map)
5. Add carrier to `SUPPORTED_CARRIERS` in `frontend/src/components/carrier-credential-settings.tsx`
6. Save credentials through the dashboard Settings → Carrier Credentials

## Files Reference

| File | Purpose |
|------|---------|
| `engine/src/index.ts` | Express server with `/verify` and `/verify-test` endpoints |
| `engine/src/agent/loop.ts` | Observe → reason → act loop with MFA handling |
| `engine/src/email/otp-reader.ts` | IMAP OTP code fetcher |
| `engine/src/credentials/store.ts` | Firestore credential fetch + decrypt |
| `engine/src/credentials/crypto.ts` | AES-256-GCM encrypt/decrypt |
| `engine/src/carriers/progressive/module.ts` | Progressive PROVE portal automation |
| `engine/src/carriers/progressive/prompts.ts` | Progressive-specific agent prompts |
| `functions/src/functions/carrier-credentials.ts` | Encrypted credential CRUD callables |
| `frontend/src/components/carrier-credential-settings.tsx` | Credential management UI |
| `frontend/src/lib/api.ts` | Frontend callable wrappers |
