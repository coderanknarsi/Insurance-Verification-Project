import { app, BrowserWindow } from "electron";
import path from "node:path";
import { launchManagedChrome, type ManagedChrome } from "./chrome-launcher";
import { connectToManagedChrome } from "./cdp";
import { logger } from "../shared/logger";

let mainWindow: BrowserWindow | null = null;
let managedChrome: ManagedChrome | null = null;

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    title: "AutoLien Operator",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Renderer is plain HTML for Phase 0; replaced by a real UI in Phase 5.
  await mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  await createMainWindow();

  try {
    managedChrome = launchManagedChrome();
    const browser = await connectToManagedChrome(managedChrome.debugPort);
    logger.info("Browser contexts on managed Chrome", {
      contextCount: browser.contexts().length,
    });
  } catch (err) {
    logger.error("Failed to bootstrap managed Chrome", { error: String(err) });
  }

  app.on("window-all-closed", () => {
    if (managedChrome?.process && !managedChrome.process.killed) {
      try {
        managedChrome.process.kill();
      } catch (err) {
        logger.warn("Failed to kill managed Chrome process", { error: String(err) });
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
