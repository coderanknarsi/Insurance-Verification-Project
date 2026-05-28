import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Browser } from "playwright-core";
import { launchManagedChrome, type ManagedChrome } from "./chrome-launcher";
import { connectToManagedChrome } from "./cdp";
import { readFirebaseConfig, readChromeDebugPort } from "./config";
import { CarrierMonitor } from "./carrier-monitor";
import { OperatorRunEngine } from "./run-engine";
import { logger } from "../shared/logger";
import type {
  AppStatus,
  ChromeConnectionState,
  HumanReviewIpcPrompt,
  HumanReviewIpcReply,
  RunPolicyRequest,
  RunPolicyResponse,
} from "../shared/bridge-types";

let mainWindow: BrowserWindow | null = null;
let managedChrome: ManagedChrome | null = null;
let browser: Browser | null = null;
const carrierMonitor = new CarrierMonitor();
const runEngine = new OperatorRunEngine();

const pendingReviews = new Map<string, (choice: string) => void>();

let chromeState: ChromeConnectionState = { status: "idle" };

function appStatus(): AppStatus {
  return {
    chrome: chromeState,
    appVersion: app.getVersion(),
  };
}

function broadcastStatus(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("operator:app-status", appStatus());
  }
}

function setChromeState(next: ChromeConnectionState): void {
  chromeState = next;
  logger.info("Chrome state changed", next);
  broadcastStatus();
}

async function startManagedChrome(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    browser = null;
  }
  if (managedChrome?.process && !managedChrome.process.killed) {
    try {
      managedChrome.process.kill();
    } catch {
      // ignore
    }
  }

  setChromeState({ status: "launching" });

  try {
    const debugPort = readChromeDebugPort();
    managedChrome = launchManagedChrome({ debugPort });

    managedChrome.process.on("exit", (code) => {
      setChromeState({
        status: "disconnected",
        reason: `Chrome exited (code ${code ?? "unknown"})`,
      });
      browser = null;
      carrierMonitor.setBrowser(null);
      runEngine.setBrowser(null);
    });

    browser = await connectToManagedChrome(managedChrome.debugPort);
    browser.on("disconnected", () => {
      setChromeState({ status: "disconnected", reason: "CDP disconnected" });
      browser = null;
      carrierMonitor.setBrowser(null);
      runEngine.setBrowser(null);
    });

    setChromeState({
      status: "connected",
      debugPort: managedChrome.debugPort,
      contextCount: browser.contexts().length,
    });
    carrierMonitor.setBrowser(browser);
    runEngine.setBrowser(browser);
  } catch (err) {
    setChromeState({ status: "error", message: String(err) });
    carrierMonitor.setBrowser(null);
    runEngine.setBrowser(null);
  }
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    title: "AutoLien Operator",
    backgroundColor: "#0b0d10",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const allowed =
      url.startsWith("https://") &&
      (/google\./i.test(url) || /firebaseapp\.com/i.test(url));
    if (!allowed) return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 520,
        height: 720,
        title: "AutoLien Operator Sign In",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      },
    };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("operator:get-firebase-config", () => readFirebaseConfig());
  ipcMain.handle("operator:get-app-status", () => appStatus());
  ipcMain.handle("operator:relaunch-chrome", async () => {
    await startManagedChrome();
  });
  ipcMain.handle("operator:get-carrier-statuses", () => carrierMonitor.list());
  ipcMain.handle("operator:open-carrier-login", async (_e, carrierId: string) => {
    await carrierMonitor.openLogin(carrierId);
  });
  ipcMain.handle("operator:recheck-carrier", async (_e, carrierId: string) => {
    await carrierMonitor.recheck(carrierId);
  });

  ipcMain.handle(
    "operator:run-policy",
    async (_e, req: RunPolicyRequest): Promise<RunPolicyResponse> => {
      const out = await runEngine.runPolicy({
        runId: req.runId,
        carrierId: req.carrierId,
        policy: req.policy,
        onHumanReview: async (review) => {
          const requestId = randomUUID();
          const prompt: HumanReviewIpcPrompt = {
            requestId,
            runId: review.runId,
            policyId: review.policyId,
            prompt: review.prompt,
            options: review.options,
            screenshotLabel: review.screenshotLabel,
          };
          return new Promise<string>((resolve) => {
            pendingReviews.set(requestId, resolve);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(
                "operator:human-review-requested",
                prompt,
              );
            } else {
              pendingReviews.delete(requestId);
              resolve("");
            }
          });
        },
      });
      return {
        result: out.result as RunPolicyResponse["result"],
        screenshots: out.screenshots,
        logs: out.logs,
        durationMs: out.durationMs,
      };
    },
  );

  ipcMain.handle(
    "operator:resolve-human-review",
    (_e, reply: HumanReviewIpcReply) => {
      const resolver = pendingReviews.get(reply.requestId);
      if (resolver) {
        pendingReviews.delete(reply.requestId);
        resolver(reply.choice);
      } else {
        logger.warn("resolve-human-review for unknown requestId", reply);
      }
    },
  );

  carrierMonitor.subscribe((statuses) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("operator:carrier-statuses", statuses);
    }
  });
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  registerIpc();
  await createMainWindow();

  // Kick off Chrome launch in the background; the renderer reflects state via IPC.
  void startManagedChrome();

  app.on("window-all-closed", () => {
    if (managedChrome?.process && !managedChrome.process.killed) {
      try {
        managedChrome.process.kill();
      } catch (err) {
        logger.warn("Failed to kill managed Chrome", { error: String(err) });
      }
    }
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

bootstrap().catch((err) => {
  logger.error("Fatal error during bootstrap", { error: String(err) });
  app.exit(1);
});
