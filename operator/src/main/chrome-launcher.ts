import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromeProfileDir } from "../shared/paths";
import { logger } from "../shared/logger";

const DEFAULT_DEBUG_PORT = 9222;

const CANDIDATE_CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(
    process.env.LOCALAPPDATA || "",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  ),
].filter((p): p is string => Boolean(p));

export interface ManagedChrome {
  process: ChildProcess;
  debugPort: number;
  profileDir: string;
}

export function resolveChromePath(): string {
  for (const candidate of CANDIDATE_CHROME_PATHS) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Could not find chrome.exe. Set CHROME_PATH env var to your Chrome install path.",
  );
}

export function launchManagedChrome(opts: { debugPort?: number } = {}): ManagedChrome {
  const chromePath = resolveChromePath();
  const debugPort = opts.debugPort ?? DEFAULT_DEBUG_PORT;
  const profileDir = chromeProfileDir();

  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=ChromeWhatsNewUI",
    "about:blank",
  ];

  logger.info("Launching managed Chrome", { chromePath, debugPort, profileDir });

  const child = spawn(chromePath, args, {
    detached: false,
    stdio: "ignore",
    windowsHide: false,
  });

  child.on("exit", (code, signal) => {
    logger.warn("Managed Chrome exited", { code, signal });
  });

  return { process: child, debugPort, profileDir };
}
