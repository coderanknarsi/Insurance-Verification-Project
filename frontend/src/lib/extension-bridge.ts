/**
 * Bridge between the dashboard and the AutoLienTracker Helper Chrome extension.
 *
 * The dashboard talks to the extension via `chrome.runtime.sendMessage(EXTENSION_ID, ...)`.
 * The extension's `externally_connectable.matches` allow-list permits this from our
 * dashboard origins.
 *
 * Because unpacked extensions get a random ID, we let the admin paste the ID into
 * the dashboard once and persist it in localStorage. Once we publish to the
 * Chrome Web Store the ID becomes stable and we can hardcode it via env var.
 */

import type { StateFarmSweepPolicyInput } from "./api";

const STORAGE_KEY = "autolt.extensionId";

const ENV_EXTENSION_ID = (
  process.env.NEXT_PUBLIC_AUTOLT_EXTENSION_ID ?? ""
).trim();

export interface SweepProgress {
  runId: string;
  done: number;
  total: number;
  success: number;
  errors: number;
  current?: {
    policyId: string;
    vin: string;
    ok: boolean;
    error?: string;
  };
}

export interface SweepCompletePayload {
  runId: string;
  success: number;
  errors: number;
  total: number;
  durationMs: number;
}

export interface SweepErrorPayload {
  runId: string;
  error: string;
}

// ---------- Extension ID storage ----------

export function getExtensionId(): string | null {
  if (ENV_EXTENSION_ID) return ENV_EXTENSION_ID;
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setExtensionId(id: string): void {
  if (typeof window === "undefined") return;
  const trimmed = id.trim();
  if (!trimmed) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, trimmed);
}

// ---------- Chrome runtime detection ----------

interface ChromeRuntime {
  sendMessage: (
    extensionId: string,
    message: unknown,
    options: unknown,
    callback: (response: unknown) => void,
  ) => void;
  onMessage: {
    addListener: (
      cb: (message: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => void,
    ) => void;
    removeListener: (
      cb: (message: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => void,
    ) => void;
  };
  lastError?: { message?: string };
}

interface ChromeGlobal {
  runtime?: ChromeRuntime;
}

function getChrome(): ChromeGlobal | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { chrome?: ChromeGlobal }).chrome;
  return c && c.runtime ? c : null;
}

export function isChromeAvailable(): boolean {
  return getChrome() !== null;
}

// ---------- Messaging ----------

function sendMessage<T>(
  extensionId: string,
  message: unknown,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const chrome = getChrome();
    if (!chrome?.runtime) {
      reject(new Error("Chrome runtime not available"));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Extension did not respond (timeout)"));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(extensionId, message, {}, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = chrome.runtime?.lastError;
        if (err) {
          reject(new Error(err.message ?? "Extension not reachable"));
          return;
        }
        resolve(response as T);
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export interface PingResult {
  ok: true;
  version?: string;
}

export async function pingExtension(
  extensionId?: string,
): Promise<PingResult | null> {
  const id = extensionId ?? getExtensionId();
  if (!id) return null;
  try {
    const resp = await sendMessage<PingResult>(id, { type: "PING" }, 3000);
    if (resp && (resp as { ok?: boolean }).ok) return resp;
    return null;
  } catch {
    return null;
  }
}

export interface StartSweepPayload {
  runId: string;
  policies: StateFarmSweepPolicyInput[];
  idToken: string;
  projectId: string;
  organizationId: string;
}

export async function startSweepInExtension(
  payload: StartSweepPayload,
  extensionId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = extensionId ?? getExtensionId();
  if (!id) return { ok: false, error: "No extension ID configured" };
  try {
    const resp = await sendMessage<{ ok: true } | { ok: false; error: string }>(
      id,
      { type: "START_SWEEP", payload },
      10_000,
    );
    return resp;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- Listening for progress messages ----------

export type SweepMessage =
  | { type: "SWEEP_PROGRESS"; payload: SweepProgress }
  | { type: "SWEEP_COMPLETE"; payload: SweepCompletePayload }
  | { type: "SWEEP_ERROR"; payload: SweepErrorPayload };

export function onSweepMessage(
  handler: (msg: SweepMessage) => void,
): () => void {
  const chrome = getChrome();
  if (!chrome?.runtime?.onMessage) return () => {};
  const listener = (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const m = message as { type?: string };
    if (
      m.type === "SWEEP_PROGRESS" ||
      m.type === "SWEEP_COMPLETE" ||
      m.type === "SWEEP_ERROR"
    ) {
      handler(message as SweepMessage);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => {
    chrome.runtime?.onMessage.removeListener(listener);
  };
}
