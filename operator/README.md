# AutoLien Operator

Windows desktop app that drives carrier verification sweeps on the user's machine via Playwright + CDP against a user-authenticated Chrome window.

See [`docs/superpowers/specs/2026-05-27-autolien-operator-design.md`](../docs/superpowers/specs/2026-05-27-autolien-operator-design.md) for the design spec.

## Status

Phase 1 — runnable skeleton. Launches a managed Chrome window via CDP, signs into Firebase from the operator window. No carrier work yet (Phase 4).

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
- [ ] Phase 2 — Carrier login tracking
- [ ] Phase 3 — Backend generalization
- [ ] Phase 4 — State Farm adapter v2
- [ ] Phase 5 — Operator UI + human review
- [ ] Phase 6 — AI vision fallback
- [ ] Phase 7 — Additional carriers
- [ ] Phase 8 — Signed installer + retire extension
