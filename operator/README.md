# AutoLien Operator

Windows desktop app that drives carrier verification sweeps on the user's machine via Playwright + CDP against a user-authenticated Chrome window.

See [`docs/superpowers/specs/2026-05-27-autolien-operator-design.md`](../docs/superpowers/specs/2026-05-27-autolien-operator-design.md) for the design spec.

## Status

Phase 0 — scaffold only. No working build yet. Do not run.

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
- [ ] Phase 1 — Electron + managed Chrome + Firebase Auth
- [ ] Phase 2 — Carrier login tracking
- [ ] Phase 3 — Backend generalization
- [ ] Phase 4 — State Farm adapter v2
- [ ] Phase 5 — Operator UI + human review
- [ ] Phase 6 — AI vision fallback
- [ ] Phase 7 — Additional carriers
- [ ] Phase 8 — Signed installer + retire extension
