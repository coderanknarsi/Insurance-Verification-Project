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

function sendToTab(tabId, message, timeoutMs = 15_000) {
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

async function ensureContentScript(tabId) {
  // Inject if the tab was open before the extension installed/reloaded.
  try {
    await sendToTab(tabId, { type: "PROBE_STATE" }, 1500);
    return; // already responding
  } catch {
    // fall through and inject
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-script.js"],
  });
}

function waitForTabComplete(tabId, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(handler);
      reject(new Error(`Tab navigation did not complete within ${timeoutMs}ms`));
    }, timeoutMs);
    function handler(id, info) {
      if (id !== tabId) return;
      if (info.status === "complete") {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(handler);
        // small settle delay for SPA-ish post-load script work
        setTimeout(resolve, 400);
      }
    }
    chrome.tabs.onUpdated.addListener(handler);
  });
}

async function probeStateWithRetry(tabId, expectedStates, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    try {
      await ensureContentScript(tabId);
      const resp = await sendToTab(tabId, { type: "PROBE_STATE" }, 3000);
      lastState = resp;
      if (expectedStates.includes(resp.state)) return resp;
    } catch (err) {
      lastState = { state: "error", error: String(err) };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Page never reached ${expectedStates.join("|")} (last seen: ${JSON.stringify(lastState)})`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyOnePolicy(tabId, policy) {
  // 1. Ensure we're on Search page.
  let state = await probeStateWithRetry(tabId, ["search"], 10_000).catch(() => null);
  if (!state) {
    // Try to navigate back to search.
    await ensureContentScript(tabId);
    await sendToTab(tabId, { type: "BACK_TO_SEARCH" }).catch(() => {});
    await waitForTabComplete(tabId).catch(() => {});
    state = await probeStateWithRetry(tabId, ["search"], 10_000);
  }

  // 2. Fill VIN and submit.
  const submit = await sendToTab(tabId, { type: "FILL_AND_SUBMIT", vin: policy.vin });
  if (!submit?.ok) throw new Error(submit?.error || "FILL_AND_SUBMIT failed");
  await waitForTabComplete(tabId).catch(() => {});

  // 3. Probe — may be auto-selection, policy-info, no-results, or still search.
  state = await probeStateWithRetry(
    tabId,
    ["auto-selection", "policy-info", "no-results"],
    20_000,
  );

  if (state.state === "no-results") {
    throw new Error(`State Farm returned no results for VIN ${policy.vin}`);
  }

  // 4. If Auto Selection, pick a row.
  if (state.state === "auto-selection") {
    const pick = await sendToTab(tabId, {
      type: "PICK_AUTO_SELECTION",
      lastName: policy.borrowerLastName,
      policyNumber: policy.policyNumber,
    });
    if (!pick?.ok) {
      if (pick?.debugTable) console.warn("[alt-helper] auto-selection debug:", pick.debugTable);
      if (pick?.radios) console.warn("[alt-helper] auto-selection radios:", pick.radios);
      throw new Error(pick?.error || "PICK_AUTO_SELECTION failed");
    }
    console.log(
      `[alt-helper] picked auto-selection row by ${pick.picked} (selector=${pick.selectorTag}, checked=${pick.checked}): ${pick.rowText}`,
    );
    if (!pick.checked) {
      console.warn("[alt-helper] auto-selection radios after pick:", pick.radios);
      throw new Error("Auto Selection row was clicked, but no policy radio became checked; refusing to submit.");
    }
    await sleep(900);
    const cont = await sendToTab(tabId, { type: "CONTINUE_AUTO_SELECTION" });
    if (!cont?.ok) {
      if (cont?.radios) console.warn("[alt-helper] auto-selection radios before Continue:", cont.radios);
      throw new Error(cont?.error || "CONTINUE_AUTO_SELECTION failed");
    }
    console.log("[alt-helper] auto-selection continue submitted:", cont);
    await waitForTabComplete(tabId).catch(() => {});
    state = await probeStateWithRetry(tabId, ["policy-info", "no-results"], 20_000);
    if (state.state === "no-results") {
      throw new Error(`State Farm returned no policy info after selecting row for VIN ${policy.vin}`);
    }
  }

  // 5. Scrape policy info.
  const scrapeResp = await sendToTab(tabId, { type: "SCRAPE" });
  if (!scrapeResp?.ok) throw new Error(scrapeResp?.error || "SCRAPE failed");

  // 6. Navigate back to Search for the next VIN (best-effort).
  await sendToTab(tabId, { type: "BACK_TO_SEARCH" }).catch(() => {});
  await waitForTabComplete(tabId).catch(() => {});

  return scrapeResp.scraped;
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
      console.log(`[alt-helper] VIN ${i + 1}/${policies.length}: ${policy.vin} → tab ${tab.id} (${tab.url})`);
      try {
        scraped = await verifyOnePolicy(tab.id, policy);
        console.log(`[alt-helper] scraped for ${policy.vin}:`, scraped);
      } catch (err) {
        errorReason = err instanceof Error ? err.message : String(err);
        console.error(`[alt-helper] VIN ${policy.vin} failed:`, errorReason);
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
