import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type { Browser } from "playwright-core";
import { launchManagedChrome, type ManagedChrome } from "./chrome-launcher";
import { connectToManagedChrome } from "./cdp";
import { readFirebaseConfig, readChromeDebugPort } from "./config";
import { logger } from "../shared/logger";
import type { AppStatus, ChromeConnectionState } from "../shared/bridge-types";

let mainWindow: BrowserWindow | null = null;
let managedChrome: ManagedChrome | null = null;
let browser: Browser | null = null;

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
    });

    browser = await connectToManagedChrome(managedChrome.debugPort);
    browser.on("disconnected", () => {
      setChromeState({ status: "disconnected", reason: "CDP disconnected" });
      browser = null;
    });

    setChromeState({
      status: "connected",
      debugPort: managedChrome.debugPort,
      contextCount: browser.contexts().length,
    });
  } catch (err) {
    setChromeState({ status: "error", message: String(err) });
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
