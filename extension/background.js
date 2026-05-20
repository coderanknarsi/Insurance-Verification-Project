/**
 * AutoLienTracker Helper — service worker (Manifest V3).
 *
 * Bridges the admin dashboard <-> State Farm tab.
 *
 * Message flow:
 *   1. Dashboard → background: { type: "PING" }
 *   2. Dashboard → background: { type: "START_SWEEP", runId, policies, idToken, projectId }
 *   3. background → content-script (on State Farm tab):
 *        { type: "VERIFY_POLICY", policy } → { ok, scraped|error }
 *   4. background → Firebase callable:
 *        recordStateFarmSweepResult({ runId, policyId, scraped|error })
 *   5. background → dashboard tab (broadcast):
 *        { type: "SWEEP_PROGRESS", runId, current, total, lastResult }
 *   6. background → Firebase callable: finalizeStateFarmSweep({ runId, status })
 *   7. background → dashboard: { type: "SWEEP_COMPLETE", runId, success, errors }
 */

const STATE_FARM_HOST_PATTERN = /\b(b2b\.)?statefarm\.com\b/i;
const POLICY_SEARCH_FRAGMENT = "InsuranceInquiry/policySearch";

/** In-memory state for the current sweep. */
let currentSweep = null;

async function callCallable(projectId, idToken, name, payload) {
  const url = `https://us-central1-${projectId}.cloudfunctions.net/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`callable ${name} failed: ${msg}`);
  }
  return json.result;
}

async function findStateFarmTab() {
  const tabs = await chrome.tabs.query({ url: "https://*.statefarm.com/*" });
  // Prefer a tab already on the Policy Search page.
  const onSearch = tabs.find((t) => t.url && t.url.includes(POLICY_SEARCH_FRAGMENT));
  return onSearch ?? tabs[0] ?? null;
}

function sendToTab(tabId, message, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`content-script timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function broadcastToDashboardTabs(message) {
  const tabs = await chrome.tabs.query({
    url: [
      "https://app.autolientracker.com/*",
      "https://insurance-track-os.web.app/*",
      "https://insurance-track-os.firebaseapp.com/*",
      "http://localhost:3000/*",
      "https://localhost:3000/*",
    ],
  });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      // dashboard tabs that don't have a listener — ignore.
    }
  }
}

async function setPopupState(state) {
  await chrome.storage.session.set({ popupState: state });
}

async function runSweep({ runId, policies, idToken, projectId, organizationId }) {
  if (currentSweep) {
    throw new Error("A sweep is already running. Wait for it to finish.");
  }
  currentSweep = { runId, total: policies.length, done: 0, success: 0, errors: 0 };
  await setPopupState({
    phase: "running",
    runId,
    total: policies.length,
    done: 0,
    success: 0,
    errors: 0,
    message: "Starting...",
  });

  try {
    let tab = await findStateFarmTab();
    if (!tab) {
      // Open the SF login page so the user can sign in.
      tab = await chrome.tabs.create({
        url: "https://apps.b2b.statefarm.com/login",
        active: true,
      });
      throw new Error(
        "Opened the State Farm login tab. Log in and navigate to the Insurance Inquiry Tool's Policy Search page, then click Start Sweep again.",
      );
    }
    if (!tab.url || !tab.url.includes(POLICY_SEARCH_FRAGMENT)) {
      await chrome.tabs.update(tab.id, { active: true });
      throw new Error(
        "Your State Farm tab is not on the Policy Search page. Navigate there in that tab, then click Start Sweep again.",
      );
    }

    for (let i = 0; i < policies.length; i++) {
      const policy = policies[i];
      const policyStart = Date.now();
      await setPopupState({
        phase: "running",
        runId,
        total: policies.length,
        done: i,
        success: currentSweep.success,
        errors: currentSweep.errors,
        message: `Verifying VIN ${policy.vin} (${i + 1}/${policies.length})`,
      });

      let scraped = null;
      let errorReason = null;
      try {
        const resp = await sendToTab(tab.id, { type: "VERIFY_POLICY", policy });
        if (!resp?.ok) throw new Error(resp?.error || "Content script returned no data");
        scraped = resp.scraped;
      } catch (err) {
        errorReason = err instanceof Error ? err.message : String(err);
      }

      try {
        await callCallable(projectId, idToken, "recordStateFarmSweepResult", {
          runId,
          policyId: policy.policyId,
          scraped: scraped ?? undefined,
          error: errorReason ?? undefined,
          durationMs: Date.now() - policyStart,
        });
      } catch (err) {
        // If we can't even post the result, surface the error; continue the loop.
        console.error("[alt-helper] recordStateFarmSweepResult failed", err);
        errorReason = errorReason ?? (err instanceof Error ? err.message : String(err));
      }

      if (errorReason) currentSweep.errors++;
      else currentSweep.success++;
      currentSweep.done = i + 1;

      await broadcastToDashboardTabs({
        type: "SWEEP_PROGRESS",
        runId,
        current: i + 1,
        total: policies.length,
        policyId: policy.policyId,
        vin: policy.vin,
        ok: !errorReason,
        error: errorReason,
      });
    }

    await callCallable(projectId, idToken, "finalizeStateFarmSweep", {
      runId,
      status: "completed",
    });
    await setPopupState({
      phase: "done",
      runId,
      total: policies.length,
      done: policies.length,
      success: currentSweep.success,
      errors: currentSweep.errors,
      message: `Done. ${currentSweep.success} verified, ${currentSweep.errors} errors.`,
    });
    await broadcastToDashboardTabs({
      type: "SWEEP_COMPLETE",
      runId,
      success: currentSweep.success,
      errors: currentSweep.errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setPopupState({
      phase: "error",
      runId,
      total: policies.length,
      done: currentSweep?.done ?? 0,
      success: currentSweep?.success ?? 0,
      errors: currentSweep?.errors ?? 0,
      message: msg,
    });
    await broadcastToDashboardTabs({
      type: "SWEEP_ERROR",
      runId,
      message: msg,
    });
    // Best-effort finalize as failed.
    try {
      await callCallable(projectId, idToken, "finalizeStateFarmSweep", {
        runId,
        status: "failed",
      });
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    currentSweep = null;
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (!message || typeof message !== "object") {
        return sendResponse({ ok: false, error: "Invalid message" });
      }
      if (message.type === "PING") {
        return sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      }
      if (message.type === "START_SWEEP") {
        const { runId, policies, idToken, projectId, organizationId } = message;
        if (!runId || !Array.isArray(policies) || !idToken || !projectId) {
          return sendResponse({ ok: false, error: "Missing runId/policies/idToken/projectId" });
        }
        // Kick off the sweep but respond immediately so the dashboard can render
        // progress via SWEEP_PROGRESS messages.
        runSweep({ runId, policies, idToken, projectId, organizationId }).catch((err) =>
          console.error("[alt-helper] sweep failed", err),
        );
        return sendResponse({ ok: true, runId });
      }
      if (message.type === "GET_STATE") {
        const { popupState } = await chrome.storage.session.get("popupState");
        return sendResponse({ ok: true, state: popupState ?? null });
      }
      return sendResponse({ ok: false, error: `Unknown message type ${message.type}` });
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true; // async response
});

// Popup talks to background via internal messages too.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "POPUP_GET_STATE") {
      const { popupState } = await chrome.storage.session.get("popupState");
      sendResponse({ ok: true, state: popupState ?? null });
    } else if (message?.type === "POPUP_OPEN_STATE_FARM") {
      const tab = await findStateFarmTab();
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { active: true });
      } else {
        await chrome.tabs.create({
          url: "https://apps.b2b.statefarm.com/login",
          active: true,
        });
      }
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: "Unknown popup message" });
    }
  })();
  return true;
});
