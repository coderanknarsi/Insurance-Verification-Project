# AutoLienTracker Helper (Chrome extension)

Lets the admin dashboard run State Farm verification sweeps without using the
terminal. The extension drives a State Farm B2B tab that the user has already
logged into (so no credentials are stored in the extension).

## Install (unpacked, while we're still pre-Web-Store)

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the **AutoLienTracker Helper** icon to your toolbar.

Note the extension ID shown on the card (e.g. `aabbcc...`). Paste it into the
dashboard's State Farm Sweep page if asked.

## Use

1. Open <https://apps.b2b.statefarm.com> and log in.
2. Navigate to the Insurance Inquiry Tool's **Policy Search** page (the one with
   the VIN field — its URL contains `InsuranceInquiry/policySearch`).
3. In the AutoLienTracker dashboard, open the org → **State Farm Sweep**.
4. Click **Start sweep**. The extension will drive the State Farm tab through
   each policy. Watch progress in the dashboard or in the extension popup.

## Files

- `manifest.json` — Manifest V3 declaration.
- `background.js` — service worker. Talks to the dashboard via
  `chrome.runtime.onMessageExternal` and to Firebase callables via `fetch`.
- `content-script.js` — runs on `*.statefarm.com`. Fills the VIN, handles the
  Auto Selection page, scrapes the Policy Information page.
- `popup.html` / `popup.js` — small status UI on the toolbar icon.

## Allowed dashboard origins

Configured in `manifest.json` under `externally_connectable.matches`:

- `https://app.autolientracker.com/*`
- `https://insurance-track-os.web.app/*`
- `https://insurance-track-os.firebaseapp.com/*`
- `http://localhost:3000/*` and `https://localhost:3000/*`
