# Beta Deployment Checklist

Pre-flight checklist for deploying Auto Lien Tracker to a friendly pilot.
Run through every section before sending intake links to real borrowers.

## 1. Secrets and configuration

### Functions (Firebase)
Set via `firebase functions:secrets:set` (sensitive) or in `functions/.env.production` (non-sensitive):

- [ ] `STRIPE_SECRET_KEY` (Secret Manager) — **live mode** key
- [ ] `STRIPE_WEBHOOK_SECRET` (Secret Manager) — from the **live** webhook endpoint
- [ ] `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE` — **live** price IDs
- [ ] `RESEND_API_KEY`
- [ ] `EMAIL_FROM_ADDRESS`
- [ ] `TELNYX_API_KEY`
- [ ] `TELNYX_PHONE_NUMBER`
- [ ] `TELNYX_MESSAGING_PROFILE_ID`
- [ ] `TELNYX_PUBLIC_KEY` — base64 from Telnyx Messaging Profile → Webhook signing
- [ ] `TELNYX_WEBHOOK_ENFORCE=true`
- [ ] `GEMINI_API_KEY`
- [ ] `DATA_FEED_ENGINE_URL` — Cloud Run URL of the deployed engine
- [ ] `ENGINE_SHARED_SECRET` — long random string

### Engine (Cloud Run)
Set via `gcloud run services update --update-env-vars`:

- [ ] `CREDENTIAL_ENCRYPTION_KEY` — 64 hex chars; **must match** the key used to encrypt stored carrier creds
- [ ] `ENGINE_SHARED_SECRET` — same value as Functions
- [ ] `NODE_ENV=production` — required to disable `/verify-test`
- [ ] `GOOGLE_AI_API_KEY`, `SMARTPROXY_USER`, `SMARTPROXY_PASS`, `CAPSOLVER_API_KEY`
- [ ] `IMAP_USER`, `IMAP_APP_PASSWORD`
- [ ] Service deployed with `--no-allow-unauthenticated`; only the Functions service account has `roles/run.invoker`

### Frontend (Vercel)
- [ ] All `NEXT_PUBLIC_FIREBASE_*` set to production project
- [ ] `NEXT_PUBLIC_USE_EMULATORS` empty/unset
- [ ] `NEXT_PUBLIC_ORG_ID` set to actual demo org id

### Landing (Vercel)
- [ ] `VITE_DASHBOARD_URL=https://app.autolientracker.com`
- [ ] `RESEND_API_KEY` and `CONTACT_EMAIL` set in Vercel project env

## 2. Firestore

- [ ] `firebase deploy --only firestore:rules`
- [ ] `firebase deploy --only firestore:indexes` — wait for all composite indexes (especially `staffTasks` and notification cadence) to build before sending production traffic
- [ ] Confirm zero "missing index" errors in Cloud Logging after first dashboard load and first scheduler run

## 3. Webhooks

- [ ] Stripe live webhook endpoint registered → events: `customer.subscription.*`, `invoice.*`, `checkout.session.completed`
- [ ] Telnyx Messaging Profile webhook URL set to deployed `telnyxInboundWebhook` URL
- [ ] Telnyx webhook signing enabled and `TELNYX_PUBLIC_KEY` matches the active key
- [ ] Send a test STOP/HELP from a real device → confirm reply received and Firestore updated
- [ ] Send a fabricated unsigned POST to the webhook → must return 401

## 4. Engine smoke tests

- [ ] `curl -X POST $ENGINE_URL/verify` without auth → 401
- [ ] `curl -X POST $ENGINE_URL/verify -H "x-engine-secret: $ENGINE_SHARED_SECRET" ...` from Functions service account → 200
- [ ] `curl $ENGINE_URL/verify-test` → 404 (route not registered in production)
- [ ] Run one real `/verify-hybrid` batch against a known policy; confirm result written to Firestore

## 5. Billing

- [ ] Run end-to-end Stripe checkout in **live mode** with a real card → subscription created, webhook received, `org.stripe.stripeSubscriptionId` populated
- [ ] Cancel + resubscribe path works
- [ ] `Add payment method` flow works for an existing subscription
- [ ] Past-due / canceled orgs cannot send intake (or beta scope is explicitly free / manual billing)

## 6. Privacy / abuse

- [ ] Insurance card upload paths persist `insuranceCardPath` and signed URL TTL ≤ 7 days
- [ ] Confirm storage bucket access rules deny anonymous reads
- [ ] Rate limit smoke test: hit `submitBorrowerIntake` 11 times in a minute → expect `RESOURCE_EXHAUSTED`
- [ ] Landing contact form: 6 submits in a minute from one IP → 429

## 7. Logs and monitoring

- [ ] Tail Functions logs for first hour; confirm no PII in error stacks (intake tokens, phone numbers, signed URLs)
- [ ] Cloud Run logs scan for accidental credential prints
- [ ] Alerting on Functions/Cloud Run 5xx rate

## 8. Repository hygiene

- [ ] No tracked `_store_creds.js`, `captured-*.json`, `deploy-output.txt`, `homepage.html`, build outputs
- [ ] `_store_creds.js` removed from git; **rotate** the leaked encryption key and the leaked Progressive password before launching, even though the file is now untracked. The key was previously committed to history.
- [ ] `.gitignore` covers env files, build outputs, captured artifacts
- [ ] All env example files current

## 9. Manual end-to-end

Run through the full happy path with one friendly pilot account before opening to others:

- [ ] Sign up → org created, no fake `trialing` blocking checkout
- [ ] Onboarding wizard
- [ ] Bulk import (CSV or AI extract) with a real DMS export
- [ ] Send intake to a real borrower phone → SMS received, link works
- [ ] Borrower uploads card → OCR + validation → policy updates
- [ ] Borrower replies HELP → staff task created, reminder cadence pauses
- [ ] Admin resolves staff task → borrower flagged as resolved
- [ ] Dealer-assisted submission flow
- [ ] Carrier verification (only for carriers validated end-to-end)
- [ ] Stripe checkout + change plan + cancel

## 10. Rollback plan

- [ ] Note current Functions and engine versions before deploy
- [ ] `firebase functions:rollback` and Cloud Run revision rollback procedures rehearsed
- [ ] Stripe webhook can be temporarily disabled if billing webhook misbehaves

## 11. Out of scope for beta

- AI calling agent — deferred
- Carriers not validated end-to-end — disable in carrier registry
- Open self-serve signup — restrict to invite-only landing
