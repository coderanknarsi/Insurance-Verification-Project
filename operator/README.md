# AutoLien Operator

Windows desktop app that drives carrier verification sweeps on the user's machine via Playwright + CDP against a user-authenticated Chrome window.

See [`docs/superpowers/specs/2026-05-27-autolien-operator-design.md`](../docs/superpowers/specs/2026-05-27-autolien-operator-design.md) for the design spec.

## Status

All 8 phases scaffolded. State Farm is the first fully-driven carrier; Progressive, Allstate, National General, GEICO, and Nationwide are stub adapters wired into the registry awaiting real flows.

## First-time setup

1. Copy `.env.example` to `.env` and fill in Firebase web config values (same project as the dashboard: `insurance-track-os`).
2. `npm install`
3. `npm run build`
4. `npm start`

The first launch opens a dedicated Chrome window under
`%LOCALAPPDATA%\AutoLienOperator\chrome-profile`. That profile is separate from
your normal Chrome; use it only for sweep work.

## Layout

```
src/
  main/         Electron main process (Chrome launcher, Playwright driver, job runner)
  renderer/     Electron renderer (operator UI)
  carriers/     Per-carrier Playwright adapters
  ai/           AI vision fallback (Phase 6)
  storage/      Run artifact uploads (screenshots, traces)
  shared/       Logger, paths, types
```

## Dev workflow (once dependencies are installed)

```powershell
cd operator
npm install
npm run build
npm start
```

## Phase tracker

- [x] Phase 0 — Spec + scaffold
- [x] Phase 1 — Electron + managed Chrome + Firebase Auth
- [x] Phase 2 — Carrier login tracking
- [x] Phase 3 — Backend generalization
- [x] Phase 4 — State Farm adapter v2 + run engine
- [x] Phase 5 — Operator UI + dashboard human-review surface
- [x] Phase 6 — AI vision fallback (stub, gated on `OPERATOR_AI_ASSIST=1`)
- [x] Phase 7 — Additional carrier scaffolds
- [x] Phase 8 — Portable + NSIS installer config; extension retired

## Packaging

```powershell
cd operator
npm run dist            # portable + NSIS installer
npm run dist:installer  # NSIS installer only
```

Artifacts land in `operator/release/`.

## Retiring the Chrome extension

The `extension/` folder remains as a reference for the State Farm scraping logic (selectors and DOM-walking helpers in `extension/content-script.js`) but is no longer the recommended way to run sweeps. Once every carrier has a working adapter in the operator, the extension folder can be removed.
