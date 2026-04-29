# Per-Org Weekly Carrier Verification — Design

**Status:** Approved 2026-04-29
**Replaces:** Sunday 2am all-orgs `weeklyDataFeedDispatcher` design

## Problem

The current `weeklyDataFeedDispatcher` runs every Sunday at 2am CT and verifies every policy across every org against carrier portals (Progressive, Allstate, State Farm, National General). Three things are wrong with this:

1. **Carrier fraud-detection risk** — bursting hundreds of logins from one IP at 2am Sunday is the exact signature carrier portals flag. Legitimate lienholder traffic is scattered across business hours.
2. **No actionable window** — issues discovered Sunday 2am sit until Monday morning. Borrowers can't be contacted until 8am Monday at earliest. We lose 30+ hours of cure time.
3. **All-or-nothing failure** — one Cloud Run cold start or one carrier outage takes the whole portfolio offline for a week.

We also have not modeled the case where a borrower is added with only VIN+name and no insurance card yet — the engine has nothing to scrape until they upload, but the existing intake-chase workflow is the right tool for that interim period.

## Goal

Each dealership has one fixed verification day Mon–Fri. Their entire eligible portfolio refreshes that morning at 7am CT. Issues land on the dealer's desk during business hours, same-day actionable. Borrowers without uploaded insurance stay in intake-chase until they upload, then graduate into the weekly sweep. Carriers without portal-scraping support get a heavier reminder cadence to compensate.

## State Model

Every borrower-policy occupies exactly one of these states. State determines which workflow operates on it.

| State | Trigger | Active Workflow |
|---|---|---|
| `PENDING_UPLOAD` | Borrower added with VIN+name only, no insurance card uploaded | Intake chase (existing SMS/email cadence) |
| `INSURED_SUPPORTED` | Card uploaded, carrier ∈ {Progressive, Allstate, State Farm, National General}, org has master creds for that carrier | Weekly carrier sweep |
| `INSURED_UNSUPPORTED` | Card uploaded, carrier outside the supported set | Bumped expiry reminders (no portal scrape) |
| `INSURED_NO_CREDS` | Supported carrier, but org has not saved master credentials for it | Bumped expiry reminders + dealer nudge to add creds |

Transitions happen on:
- Borrower upload (PENDING_UPLOAD → one of the INSURED_* states)
- Credential save/revoke (INSURED_SUPPORTED ↔ INSURED_NO_CREDS)
- Policy expiry/cancellation (any → out of sweep, into lapse-cadence workflow)

A policy is never in two states at once. The intake-chase and weekly-sweep workflows therefore never touch the same policy.

## Per-Org Verification Day

Each org gets a stable weekday assignment:

```
verificationDayOfWeek = hash(orgId) % 5    // 1=Mon … 5=Fri
```

Persisted as `org.settings.verificationDayOfWeek: number`. Default value is the hash on first read; admins can override via Settings → Organization Profile. Org profile UI shows: *"Your portfolio refreshes every Wednesday morning."*

### Cron schedule change

- **Before:** `0 2 * * 0` (Sunday 2am CT, all orgs)
- **After:** `0 7 * * 1-5` (Mon–Fri 7am CT)

The dispatcher itself filters orgs to those whose `verificationDayOfWeek` equals today's weekday. One cron, five execution days, ~20% of total org load per day.

## Dispatcher Eligibility Filter

Existing `weeklyDataFeedDispatcher` already groups policies by org and carrier. New filter applied per policy:

```
ELIGIBLE for engine sweep IF:
  policy.status ∈ {ACTIVE, EXPIRING_SOON}
  AND policy.insuranceProvider is set
  AND normalizeCarrier(provider) ∈ supported carrier set
  AND org has active master credentials for that carrier

OTHERWISE routed to:
  PENDING_UPLOAD   → intake-chase workflow (already running, untouched)
  INSURED_UNSUPPORTED or INSURED_NO_CREDS → bumped reminder cadence
```

The dispatcher logs counts per bucket on each run so the run record shows: *"Frazer Motors today: 47 verified, 12 awaiting upload, 8 unsupported carrier, 3 missing credentials."*

## Bumped Cadence for Unsupported / No-Creds Policies

Today: one expiry reminder cadence driven by `complianceRules.expiryReminderDays`.

Adding: a second, more-aggressive cadence for policies the engine can't verify. Same `dailyExpiryReminder` cron at 9am CT — branches based on policy verification eligibility. No new cron.

| Days before expiry | Standard (verified weekly) | Bumped (unverifiable) |
|---|---|---|
| 30 | — | reminder |
| 14 | — | reminder |
| 7 | reminder | reminder |
| 3 | — | reminder |
| 1 | reminder | reminder |
| Day-of | — | reminder + dealer alert |

The bumped cadence is double-edged: it earns trust ("we adapt the cadence to whether we can verify automatically") but also generates more borrower contact. Org settings should not expose this to dealers in v1 — fixed default, revisit after first 10 paying customers.

## Onboarding Kickoff

When a dealer onboards (or bulk-imports a portfolio):

1. **Immediate:** for every borrower in `PENDING_UPLOAD` with phone+SMS-consent or email, fire the intake link via existing `requestBorrowerIntake`. Throttled at ~5 sends/second to respect Telnyx rate limits and carrier deliverability.
2. **No engine sweep on onboarding day** — borrowers need 3–7 days to upload. Premature sweeps would just produce empty results.
3. **First engine sweep** runs on the org's normal assigned weekday. By then, uploaders are eligible; non-uploaders stay in intake-chase.
4. **Quiet-hours respect** — bulk intake fired outside 8am–9pm CT queues for the next morning. A 200-borrower portfolio onboarded at 8pm fires at 8am next day.

Trigger: new `onOrgOnboardingComplete` callable invoked from the onboarding wizard's final step and from bulk-import success. Existing per-borrower SMS consent and quiet-hours rules apply unchanged.

## Dashboard Surfacing

Three UI changes:

1. **Org-level header strip** on the dashboard: *"Last verification sweep: Wed 4/29 7:14am · Next: Wed 5/6 7:00am · 47/67 policies in scope"*. Tells the dealer at a glance when fresh data lands.
2. **Per-borrower badges** in the table:
   - Green check + timestamp → Verified this week (engine confirmed)
   - Yellow clock → Awaiting upload (intake-chase active)
   - Gray shield-with-slash → Unsupported carrier — relying on uploaded proof + expiry tracking
   - Orange key → Carrier supported, missing credentials — add to enable verification
3. **Sweep run record** in the Verifications tab: each weekly run shows as one collapsible row with per-policy results inside. The dealer sees "Wednesday's sweep" as a single event, not 47 individual notifications.

## Error Handling

- **Engine returns failure for a policy** → keep prior verification data, dashboard shows last successful timestamp + warning icon. Three consecutive sweep failures = dealer alert email.
- **Master credentials revoked / login fails** → policies for that carrier in that org transition to `INSURED_NO_CREDS` for cadence purposes; dealer gets immediate email "Your Progressive credentials need attention".
- **Engine endpoint unreachable / Cloud Run cold-start failure** → dispatcher retries with exponential backoff up to 3x within the 9-minute Cloud Functions timeout; if still failing, marks run `failed` and posts internal alert.
- **Carrier rate-limit / portal block** → engine module returns structured `RATE_LIMITED` error; dispatcher pauses that org's batch for 30 min then retries once. Repeated rate-limits trigger automatic spread of that org to a second day (manual review flag).

## Testing Strategy

Three independently-runnable layers:

1. **Smoke test (engine alone)** — `POST /verify-test` with captured Progressive `autoLT` creds + a known VIN. Confirms login + search + extraction work after code changes.
2. **Pipeline integration test** — manually trigger `weeklyDataFeedDispatcher` from Cloud Scheduler with a test org containing 3 known policies (one verifiable, one unsupported carrier, one pending upload). Watch Firestore: dispatcher run record, per-policy verification result, dashboard badges all reflect expected outcomes.
3. **Cadence test** — backdate a policy to expire in 30 days, set carrier to GEICO (unsupported), watch bumped reminder fire. Repeat with a verified Progressive policy at expiry-7 to confirm standard cadence fires instead.

New admin-only callable: `simulateVerificationSweep(orgId)` runs any org's sweep on demand for QA without waiting for the cron.

## Out of Scope (YAGNI)

Explicitly not in this iteration:
- Per-policy verification day overrides (org-level only)
- Multiple sweeps per week per org (one weekly is enough; more = carrier risk)
- Dealer-configurable cadence for unsupported carriers (one reasonable default)
- Dynamic carrier-supported list (hardcoded set of 4; expand by adding modules)
- Hybrid path swap from `/verify` to `/verify-hybrid` for Progressive (separate effort — this design stays on `/verify` for all 4 carriers)

## Files Touched (preview)

| File | Action | Purpose |
|---|---|---|
| `functions/src/functions/data-feed-dispatcher.ts` | Modify | Cron schedule, per-org day filter, eligibility filter, bucket logging |
| `functions/src/functions/daily-expiry-reminder.ts` | Modify | Branch on policy verification eligibility, apply bumped cadence |
| `functions/src/functions/onboarding-kickoff.ts` | Create | New callable that bulk-fires intake links on onboarding/import |
| `functions/src/functions/simulate-verification-sweep.ts` | Create | Admin-only QA trigger |
| `functions/src/types/organization.ts` | Modify | Add `verificationDayOfWeek?: number` to settings |
| `functions/src/services/verification-eligibility.ts` | Create | Single-source-of-truth `getPolicyVerificationState()` helper |
| `frontend/src/components/borrower-table.tsx` | Modify | Per-borrower verification state badges |
| `frontend/src/components/dashboard-header.tsx` | Modify | Last/next sweep header strip |
| `frontend/src/components/verifications-tab.tsx` | Modify | Collapsible sweep-run rows |
| `frontend/src/components/organization-profile-form.tsx` | Modify | Verification-day selector |
