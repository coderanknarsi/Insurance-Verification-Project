import type { Browser, BrowserContext, Page } from "playwright-core";
import { listCarrierAdapters, getCarrierAdapter } from "../carriers/registry";
import type { CarrierAdapter } from "../carriers/types";
import { logger } from "../shared/logger";
import type { CarrierStatus } from "../shared/bridge-types";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 25_000;

type Listener = (statuses: CarrierStatus[]) => void;

interface State {
  status: CarrierStatus;
  inFlight: Promise<void> | null;
}

export class CarrierMonitor {
  private states = new Map<string, State>();
  private listeners = new Set<Listener>();
  private browser: Browser | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    for (const adapter of listCarrierAdapters()) {
      this.states.set(adapter.id, {
        status: {
          id: adapter.id,
          name: adapter.name,
          loginUrl: adapter.loginUrl,
          searchUrl: adapter.searchUrl,
          status: "unknown",
          lastCheckedAt: null,
          lastError: null,
        },
        inFlight: null,
      });
    }
  }

  list(): CarrierStatus[] {
    return Array.from(this.states.values()).map((s) => s.status);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setBrowser(browser: Browser | null): void {
    this.browser = browser;
    if (!browser) {
      this.stopPolling();
      for (const [, state] of this.states) {
        state.status = {
          ...state.status,
          status: "unknown",
          lastError: "Chrome not connected",
        };
      }
      this.emit();
      return;
    }
    this.startPolling();
    void this.checkAll();
  }

  startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkAll();
    }, HEARTBEAT_INTERVAL_MS);
  }

  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkAll(): Promise<void> {
    if (!this.browser) return;
    await Promise.all(
      Array.from(this.states.keys()).map((id) => this.recheck(id).catch(() => {})),
    );
  }

  async recheck(carrierId: string): Promise<void> {
    const state = this.states.get(carrierId);
    if (!state) return;
    if (state.inFlight) return state.inFlight;
    const adapter = getCarrierAdapter(carrierId);
    if (!adapter) return;
    if (!this.browser) {
      state.status = {
        ...state.status,
        status: "unknown",
        lastError: "Chrome not connected",
      };
      this.emit();
      return;
    }

    state.status = { ...state.status, status: "checking", lastError: null };
    this.emit();

    state.inFlight = this.runHeartbeat(adapter)
      .then((result) => {
        state.status = {
          ...state.status,
          status: result.ok ? "logged-in" : "logged-out",
          lastCheckedAt: Date.now(),
          lastError: null,
        };
      })
      .catch((err: unknown) => {
        state.status = {
          ...state.status,
          status: "error",
          lastCheckedAt: Date.now(),
          lastError: err instanceof Error ? err.message : String(err),
        };
      })
      .finally(() => {
        state.inFlight = null;
        this.emit();
      });

    return state.inFlight;
  }

  private async runHeartbeat(adapter: CarrierAdapter): Promise<{ ok: boolean }> {
    if (!this.browser) throw new Error("Chrome not connected");
    const context = this.firstContext(this.browser);
    if (!context) throw new Error("No browser context available");

    // Use a dedicated probe page so we don't disturb the user's tabs.
    const page = await context.newPage();
    try {
      const ok = await Promise.race<boolean>([
        adapter.isLoggedIn(page),
        timeout<boolean>(HEARTBEAT_TIMEOUT_MS, "heartbeat timed out"),
      ]);
      return { ok };
    } finally {
      try {
        await page.close({ runBeforeUnload: false });
      } catch (err) {
        logger.warn("Failed to close heartbeat page", { error: String(err) });
      }
    }
  }

  async openLogin(carrierId: string): Promise<void> {
    const adapter = getCarrierAdapter(carrierId);
    if (!adapter) throw new Error(`Unknown carrier: ${carrierId}`);
    if (!this.browser) throw new Error("Chrome is not connected. Try Relaunch Chrome first.");
    const context = this.firstContext(this.browser);
    if (!context) throw new Error("No browser context available");
    let target: Page | null = null;
    for (const p of context.pages()) {
      try {
        if (p.url().includes("statefarm.com")) {
          target = p;
          break;
        }
      } catch {
        // ignore
      }
    }
    if (!target) {
      target = await context.newPage();
    }
    try {
      await target.bringToFront();
    } catch {
      // not fatal
    }
    await target.goto(adapter.loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  private firstContext(browser: Browser): BrowserContext | null {
    const contexts = browser.contexts();
    return contexts.length > 0 ? contexts[0] : null;
  }

  private emit(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        logger.warn("Carrier status listener threw", { error: String(err) });
      }
    }
  }
}

function timeout<T>(ms: number, msg: string): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}
