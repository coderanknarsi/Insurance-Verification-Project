# Borrower Communication Cadence — Design Spec

**Date:** 2026-04-26
**Status:** Approved (pending final read-through)
**Author:** Auto Lien Tracker

## Goal

Define the complete set of compliance states a borrower can be in, what triggers transitions between them, and the messages we send at each stage. The cadence drives both backend schedulers and the UI timeline that surfaces communication history per borrower.

## Non-Goals

- CPI placement itself (we hand off to the lender's chosen carrier; v1 terminal stage is a "soft" warning that the lender *may* force-place or repo).
- Becoming a CPI carrier or holding a producer license.
- Certified mailed letters via Lob (deferred; can be added as a per-org toggle later).

## Compliance State Machine

A borrower is always in exactly one compliance state, set by the weekly verification job and the dailyExpiryReminder/dailyLapseEscalation schedulers.

```
COMPLIANT
   │
   ├── endDate ≤ T+10 days ───────► EXPIRING_SOON
   │                                    │ (no cure required; informational reminders only)
   │                                    ▼
   │                                 endDate passes ─► LAPSED_EXPIRED
   │
   ├── endDate passed ────────────► LAPSED_EXPIRED ──┐
   ├── carrier reports cancelled ─► LAPSED_CANCELLED ├─► full lapse cadence
   ├── 2 consecutive verif fails ─► LAPSED_UNKNOWN ──┘
   │
   ├── deductible / liability /
   │   lienholder rules violated ─► NON_COMPLIANT_COVERAGE ─► coverage cure cadence
   │
   └── valid proof received ──────► COMPLIANT (cure)
```

### State definitions

| State | Meaning |
|---|---|
| `COMPLIANT` | Active policy, meets all rules in `complianceRules`, lienholder listed |
| `EXPIRING_SOON` | Active policy, within pre-expiry reminder window |
| `LAPSED_EXPIRED` | endDate < today, no replacement policy detected |
| `LAPSED_CANCELLED` | Carrier portal returned status = cancelled |
| `LAPSED_UNKNOWN` | 2+ consecutive verification failures (could be borrower switched carriers without telling us, or genuinely uninsured) |
| `NON_COMPLIANT_COVERAGE` | Active policy but deductible too high, liability too low, or lienholder missing |

### Transitions

- **Weekly verification job** writes the new state based on what it finds (or fails to find) on the carrier portal.
- **Borrower upload** of a corrected declarations page → next verification → returns to `COMPLIANT` → triggers cure email.
- A single borrower can move through multiple states over time; each transition is logged as a state-change event for the timeline UI.

## Cadence Tables

All days are calendar days. T = the date the state was first entered (`stateChangedAt`). All sends respect the org's quiet hours and the borrower's SMS opt-in/quiet-hours rules already implemented.

### 1. Pre-expiry reminders (already partially built)

State: `EXPIRING_SOON`. Trigger: `EXPIRING_SOON`.

| # | Day | Channels | Tone |
|---|---|---|---|
| 1 | T-10 | Email | Friendly heads-up |
| 2 | T-3 | Email + SMS | Reminder |
| 3 | T-1 | Email + SMS | Last chance before expiry |

Existing `dailyExpiryReminder` covers a single reminder; this expands it to three.

### 2. Lapse cadence (new)

States: `LAPSED_EXPIRED`, `LAPSED_CANCELLED`, `LAPSED_UNKNOWN`. Same days, different copy per state.

| Stage | Trigger | Day | Channels |
|---|---|---|---|
| Lapse Notice #1 | `LAPSED_FIRST_NOTICE` | T+1 | Email + SMS |
| Lapse Notice #2 | `LAPSED_SECOND_NOTICE` | T+10 | Email + SMS |
| Final Notice (CPI/repo warning) | `LAPSED_FINAL_NOTICE` | T+20 | Email + SMS |
| Cure confirmation | `LAPSE_CURED` | on return to `COMPLIANT` | Email |

Copy escalation by state:

- **`LAPSED_EXPIRED`** — benefit of the doubt early ("your policy expired on [date], please send updated proof"), warning language only at final.
- **`LAPSED_CANCELLED`** — no benefit of the doubt; first notice already states the carrier confirmed cancellation and the borrower is currently uninsured.
- **`LAPSED_UNKNOWN`** — softer ("we couldn't verify your current coverage"), invites borrower to send proof; final notice still escalates if no response.

### 3. Verification-failure soft-ask (new)

After 1 failed verification (week 1), before entering `LAPSED_UNKNOWN`:

| Stage | Trigger | Day | Channels | Copy |
|---|---|---|---|---|
| Soft request | `VERIFICATION_PROOF_REQUEST` | day after fail | Email | "We couldn't reach your carrier this week. Please send your latest declarations page so we can confirm your coverage is active." |

If the next weekly verification still fails, state becomes `LAPSED_UNKNOWN` and the lapse cadence begins.

### 4. Coverage cure cadence (new)

State: `NON_COMPLIANT_COVERAGE`. Slower tempo because the borrower IS insured, just not adequately.

| Stage | Trigger | Day | Channels |
|---|---|---|---|
| Notice #1 | `COVERAGE_FIRST_NOTICE` | T+1 | Email |
| Notice #2 | `COVERAGE_SECOND_NOTICE` | T+14 | Email + SMS |
| Final Notice (CPI/repo warning) | `COVERAGE_FINAL_NOTICE` | T+30 | Email + SMS |
| Cure confirmation | `COVERAGE_CURED` | on return to `COMPLIANT` | Email |

Copy specifics: notice cites the exact violation pulled from the policy ("Your collision deductible is $2,500. Your loan agreement requires $1,000 or less.") so the borrower knows exactly what to fix.

## Final-Notice Wording (terminal stage)

Used at `LAPSED_FINAL_NOTICE` and `COVERAGE_FINAL_NOTICE`. Lender name is templated from `organization.displayName`.

> Your loan agreement with **[Lender Name]** requires you to maintain continuous auto insurance on your **[year make model]** that meets the lender's coverage requirements. Our records show your coverage is currently [lapsed since [date] / non-compliant: [violation]].
>
> If proof of compliant coverage is not received by **[date]**, [Lender Name] may exercise its rights under your loan agreement, which can include:
>
> - Force-placing insurance at your expense (this can add $1,500–$3,000/yr to your loan balance), or
> - Repossession of the vehicle.
>
> To resolve this, send your current declarations page to **[org email]** or upload it at **[portal link]**.

We are stating what the lender *may* do under their existing contract, not what we will do. This keeps Auto Lien Tracker out of the carrier/insurance business entirely.

## Schema Changes

### `Borrower` (new fields)

```ts
complianceState: ComplianceState;          // enum, see above
stateChangedAt: Timestamp;                 // T for current cadence
lastVerificationFailedAt?: Timestamp;      // for soft-ask logic
consecutiveVerificationFailures: number;   // for LAPSED_UNKNOWN trigger
```

### `NotificationTrigger` (new enum values)

```ts
LAPSED_FIRST_NOTICE
LAPSED_SECOND_NOTICE
LAPSED_FINAL_NOTICE
LAPSE_CURED
COVERAGE_FIRST_NOTICE
COVERAGE_SECOND_NOTICE
COVERAGE_FINAL_NOTICE
COVERAGE_CURED
VERIFICATION_PROOF_REQUEST
```

Existing `LAPSE_DETECTED`, `REINSTATEMENT_REMINDER`, `EXPIRING_SOON`, `INTAKE_REQUESTED`, `INTAKE_COMPLETED`, `DEALER_SUBMITTED` are preserved.

### `Organization.complianceRules` (additive)

```ts
preExpiryReminders: { days: number[] }              // default [10, 3, 1]
lapseEscalation: {                                  // default { 1, 10, 20 }
  firstNoticeDays: number;
  secondNoticeDays: number;
  finalNoticeDays: number;
};
coverageEscalation: {                               // default { 1, 14, 30 }
  firstNoticeDays: number;
  secondNoticeDays: number;
  finalNoticeDays: number;
};
unknownStatePolicy: {
  consecutiveFailuresBeforeLapse: number;           // default 2
};
```

All fields are optional with the defaults above; existing orgs continue to work without migration.

## Schedulers

| Scheduler | Frequency | Purpose |
|---|---|---|
| `weeklyDataFeedDispatcher` *(existing)* | Sun 2 AM CT | Runs verification, writes new `complianceState` and increments/resets `consecutiveVerificationFailures` |
| `dailyExpiryReminder` *(extend)* | 9 AM CT daily | Sends pre-expiry reminders at T-10/T-3/T-1 based on org config |
| `dailyLapseEscalation` *(new)* | 9 AM CT daily | For each borrower in a `LAPSED_*` state, sends the appropriate notice if today matches T+1/T+10/T+20 from `stateChangedAt` |
| `dailyCoverageEscalation` *(new — could share scheduler with lapse)* | 9 AM CT daily | For each borrower in `NON_COMPLIANT_COVERAGE`, sends the appropriate notice if today matches T+1/T+14/T+30 |

For simplicity we may run a single `dailyComplianceEscalation` scheduler that handles all post-state-change escalations.

## Onboarding Wizard Changes

Replace the "Days before expiry to send reminder" number field with a single toggle:

> ☑ **Auto-send expiry reminders and lapse notices**
> We'll email and text borrowers before their policy expires (10, 3, and 1 days out) and follow up with lapse notices if coverage isn't renewed. You can customize the schedule in Settings.

Move full cadence configuration to **Settings → Notifications**.

## UI Implications (out of scope for this spec, but locked in for next round)

The notification timeline in the borrower detail panel needs to render every trigger in this design. The data model is rich enough already (notifications collection has `trigger`, `channel`, `status`, `createdAt`, `content`); the UI work is purely presentational. State *transitions* (e.g. `COMPLIANT → LAPSED_CANCELLED`) should also be logged as timeline events so the operator can see "policy was cancelled on Mar 12" alongside "Lapse Notice #1 sent on Mar 13."

## Out of Scope (Deferred)

- Lob certified mail integration
- CPI placement packet generation
- Self-serve template editing of message copy (defaults only for v1)
- Per-borrower cadence overrides (org-level only for v1)
- Webhook to dealer's DMS to push state changes back

## Open Questions to Confirm

1. Single `dailyComplianceEscalation` scheduler vs separate lapse + coverage schedulers? *(recommend single)*
2. Should `EXPIRING_SOON` reminders pause if the borrower has uploaded a renewal policy that's pending verification? *(recommend yes — show a "renewal pending" pill instead)*
3. Final notice should include a deadline date — fixed +10 days from send, or configurable?
