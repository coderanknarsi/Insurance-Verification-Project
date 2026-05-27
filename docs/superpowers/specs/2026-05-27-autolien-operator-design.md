# AutoLien Operator — Design Spec

**Status:** Approved 2026-05-27
**Owner:** info@autolientracker.com
**Replaces:** Chrome extension (`extension/`) for carrier verification sweeps
**First carrier:** State Farm. Additional carriers added one-by-one after State Farm is proven reliable.

---

## 1. Problem

The Chrome extension architecture (MV3 + content scripts) is too fragile to reliably drive carrier portals like State Farm. Service-worker lifecycle, navigation-killed message channels, and HTTP 400s on Auto Selection make it unusable for weekly production sweeps.

The user is willing to log into carrier portals manually. We just need a reliable driver that uses the already-authenticated browser session.

## 2. Solution

A Windows desktop app — **AutoLien Operator** — built in Electron + TypeScript that:

1. Launches a dedicated Chrome window (separate profile) with the DevTools port open.
2. Connects to that Chrome via Playwright (`chromium.connectOverCDP`).
3. Pulls verification jobs from Firestore (`dataFeedRuns`) the same way the dashboard does.
4. Drives the per-carrier flow through Playwright, scrapes results, and writes them back to Firestore.
5. Shows a small operator UI for login status, run progress, and human-in-the-loop prompts when a page is ambiguous.

The admin dashboard gains a new **Sweeps** section where runs are launched and observed. Day-to-day execution moves to the operator app on the user's machine. No carrier credentials are stored in our system.

## 3. Architecture

```
┌─────────────────────┐       ┌───────────────────────────────┐
│ Admin Dashboard     │       │ Firebase                       │
│ /admin/sweeps       │──────▶│ • Functions (callables)        │
│ (Next.js / Vercel)  │◀──────│ • Firestore (dataFeedRuns)     │
└─────────────────────┘       │ • Storage (screenshots/traces) │
                              └──────────────┬─────────────────┘
                                             │
                                             │ Firestore listener +
                                             │ callables
                                             ▼
                              ┌────────────────────────────────┐
                              │ AutoLien Operator (Electron)   │
                              │  • Tray icon + main window     │
                              │  • Firebase Auth (super-admin) │
                              │  • Playwright driver           │
                              │  • Carrier adapters            │
                              │  • Human-review queue          │
                              └──────────────┬─────────────────┘
                                             │ CDP
                                             ▼
                              ┌────────────────────────────────┐
                              │ Managed Chrome (dedicated      │
                              │ profile, --remote-debugging-   │
                              │ port=9222)                     │
                              │  • Tabs: State Farm B2B,       │
                              │    Progressive, etc.           │
                              │  • User logs in manually       │
                              └────────────────────────────────┘
```

## 4. Components

### 4.1 Repo layout

```
operator/
  package.json
  tsconfig.json
  electron-builder.yml
  src/
    main/                # Electron main process
      index.ts
      chrome-launcher.ts
      cdp.ts
      firebase-auth.ts
      job-runner.ts
      ipc.ts
    renderer/            # Electron renderer (operator UI)
      index.html
      app.tsx
      panels/
        carriers-panel.tsx
        active-runs-panel.tsx
        human-review-panel.tsx
        recent-runs-panel.tsx
    carriers/
      types.ts           # CarrierAdapter interface
      registry.ts
      state-farm/
        adapter.ts
        selectors.ts
        scrape.ts
    ai/
      vision-fallback.ts
    storage/
      run-artifacts.ts   # screenshots + Playwright traces
    shared/
      logger.ts
      paths.ts           # %LOCALAPPDATA% paths
```

### 4.2 Admin dashboard additions

- New route: `frontend/src/app/admin/sweeps/page.tsx` — "Verification Sweeps" section.
- New left-nav (or top-nav) entry in the admin layout pointing to `/admin/sweeps`.
- Contents:
  - Carrier picker (State Farm to start; others appear as adapters ship).
  - Organization picker (which dealership to sweep).
  - "Run Sweep" button → triggers `startManualCarrierSweep` callable.
  - Live runs panel (subscribes to `dataFeedRuns` where `createdBy == uid`).
  - Recent runs history with drill-down to per-VIN results.
  - Per-run detail view: VIN list, status, screenshot links, "needs review" items.
- The existing State Farm-specific dialog (`state-farm-sweep-dialog.tsx`) is repurposed or replaced by this section.

### 4.3 Backend (Firebase Functions)

Generalize existing State Farm callables into carrier-agnostic ones (keep old as thin wrappers during migration):

| New callable | Replaces | Purpose |
|---|---|---|
| `startManualCarrierSweep({ organizationId, carrierId })` | `startStateFarmSweep` | Creates a `dataFeedRuns` doc with `mode: "manual-operator"` and `carrierId`. |
| `recordManualSweepResult({ runId, policyId, scraped?, error? })` | `recordStateFarmSweepResult` | Writes a per-VIN result. |
| `finalizeManualSweep({ runId, status })` | `finalizeStateFarmSweep` | Marks the run complete. |
| `requestHumanReview({ runId, policyId, prompt, options, screenshotPath })` | new | Operator app pauses on an ambiguous page; dashboard surfaces it. |
| `resolveHumanReview({ runId, policyId, choice })` | new | Dashboard sends the operator app the chosen option. |

### 4.4 Firestore additions

- `dataFeedRuns/{runId}` gains:
  - `carrierId: string`
  - `mode: "manual-operator" | "extension"` (legacy)
  - `operatorMachineId?: string` (which machine claimed the run)
- New subcollection `dataFeedRuns/{runId}/humanReviews/{reviewId}` for paused VINs.
- `dataFeedRuns/{runId}/results/{policyId}` gains:
  - `screenshotPaths: string[]` (Firebase Storage)
  - `tracePath?: string`
  - `aiSteps?: Array<{ ts, action, reasoning }>`

### 4.5 Firebase Storage layout

```
dataFeedRuns/{runId}/results/{policyId}/
  step-01-search.png
  step-02-results.png
  step-03-policy.png
  trace.zip
```

### 4.6 Carrier adapter interface

```ts
export interface CarrierAdapter {
  id: string;                                // "state-farm"
  name: string;                              // "State Farm B2B"
  loginUrl: string;
  searchUrl: string;
  isLoggedIn(page: Page): Promise<boolean>;
  verifyVin(
    page: Page,
    policy: PolicyInput,
    ctx: AdapterContext,
  ): Promise<ScrapeResult>;
}

export interface AdapterContext {
  runId: string;
  policyId: string;
  log: (msg: string, data?: unknown) => void;
  screenshot: (label: string) => Promise<string>;       // returns storage path
  requestHumanReview: (prompt: string, options: ReviewOption[]) => Promise<string>;
  aiAssist?: (prompt: string) => Promise<AiAction>;
}

export type ScrapeResult =
  | { status: "found"; data: PolicyScrape }
  | { status: "not-found" }
  | { status: "error"; reason: string }
  | { status: "needs-review"; reviewId: string };
```

## 5. User workflow (weekly)

1. **Morning of sweep day** — user double-clicks **AutoLien Operator** from Start Menu.
2. App opens its main window and launches the managed Chrome window with carrier tabs pinned (State Farm to start).
3. App shows each carrier as **Login needed**.
4. User logs into State Farm B2B in the managed Chrome window. App detects auth via heartbeat poll and flips the carrier badge to **Ready**.
5. User opens the admin dashboard → **Sweeps** → picks a dealership → clicks **Run Sweep (State Farm)**.
6. Backend creates the run doc. Operator app sees it, claims it, drives the sweep.
7. Dashboard and operator app both show live per-VIN progress.
8. If a VIN hits an ambiguous screen, the operator app pauses that VIN and adds a Human Review item visible in both the operator app and the dashboard. User clicks the correct option, sweep resumes.
9. When the run finishes, results are in Firestore. The dashboard shows the same data feed as today.

## 6. Security

- **No carrier passwords stored.** Sessions live only in the dedicated Chrome profile cookie jar.
- **Firebase Auth** in the operator app uses the super-admin account. Refresh token stored in **Windows Credential Manager** via `keytar`.
- **Machine binding.** First run registers a machine fingerprint to the user's Firestore profile (`users/{uid}/operatorMachines/{machineId}`). Runs can only be claimed by registered machines.
- **Signed installer.** Code-signing certificate for the Windows installer to avoid SmartScreen warnings. (Deferred until Phase 8.)
- **Firestore rules.** `dataFeedRuns` already restricts read to `createdBy == request.auth.uid`. We add a rule allowing super-admin reads. No public read of screenshots — Storage rules require auth.

## 7. AI vision fallback (Phase 6)

Used only when a deterministic adapter step throws or a probe returns "unknown page". The fallback:

1. Captures screenshot + simplified DOM outline.
2. Sends to Gemini 2.x or Claude 3.x with a strict tool schema.
3. Model returns one of:
   - `{ action: "click", selectorHint }` — adapter locates a real selector and clicks.
   - `{ action: "type", selectorHint, text }`
   - `{ action: "pause-for-human", reason }` — surfaces to Human Review.
4. Hard cap: 3 AI actions per VIN, then auto-escalate to Human Review.
5. Every AI decision logged to `results/{policyId}/aiSteps`.

## 8. Phased build plan

| Phase | Scope | Acceptance |
|---|---|---|
| **0** | Spec doc + `operator/` scaffold + new `/admin/sweeps` route stub. | Spec committed; folder builds; route renders empty section. |
| **1** | Electron app skeleton; managed Chrome launch; Playwright CDP connect; Firebase Auth in app. | App opens Chrome, signs in, shows "Connected". |
| **2** | Carrier login tracking (State Farm heartbeat). | Logging into State Farm flips the carrier card to Ready within 30s. |
| **3** | Backend generalization (new callables + Firestore schema). Dashboard `/admin/sweeps` reads/writes the new shape. | Dashboard run button creates a `manual-operator` run doc. |
| **4** | State Farm adapter v2 in Playwright with per-step screenshots. | Re-run a VIN that previously failed in the extension; clean scrape. |
| **5** | Operator UI: active runs, recent runs, human review. Dashboard human-review surface. | Ambiguous Auto Selection pauses; user clicks; sweep resumes. |
| **6** | AI vision fallback. | Manual selector breakage in a test fixture is recovered automatically. |
| **7** | Additional carriers, one at a time: Progressive → Allstate → National General → GEICO → Nationwide. | Each carrier passes its own acceptance test. |
| **8** | Signed Windows installer, auto-update via GitHub Releases, first-run setup wizard. Retire `extension/`. | Fresh Windows machine installs and runs a State Farm sweep without dev tooling. |

## 9. What we keep / retire

**Keep:**
- All Firebase callables (generalized).
- `state-farm-sweep-dialog.tsx` logic for live progress (folded into `/admin/sweeps`).
- `functions/src/services/state-farm-normalize.ts`.
- Engine scaffolds under `engine/src/carriers/` (reused as reference; the active code path becomes `operator/src/carriers/`).
- Existing `dataFeedRuns` schema (extended, not replaced).

**Retire (after Phase 8):**
- `extension/` (Chrome extension).
- `frontend/src/lib/extension-bridge.ts`.
- Extension-ID UI in the dashboard.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Carrier detects Playwright/CDP. | Real Chrome + user-logged-in profile. Stealth flags. AI vision fallback uses real input events. |
| Antivirus flags the unsigned installer. | Sign installer in Phase 8. Until then, ship as a portable folder. |
| State Farm portal outages (already observed). | App reports clean per-VIN errors with screenshots. User retries next day. Not solvable by software. |
| OTP/2FA at carrier login. | User handles manually. App only waits for "Ready" state. |
| Multiple machines claim the same run. | Atomic Firestore transaction on run claim. Operator writes `operatorMachineId` only if currently null. |

## 11. Open questions

None blocking. Carriers beyond State Farm will be prioritized as they are added.

---

## Approval

User approved 2026-05-27:
- Electron is fine.
- Sweeps live in a new section of the admin dashboard.
- Build State Farm first, add the rest one by one.
