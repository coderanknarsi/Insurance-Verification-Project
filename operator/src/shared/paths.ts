import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const APP_DIR_NAME = "AutoLienOperator";

function localAppData(): string {
  return (
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), "AppData", "Local")
  );
}

export function appDataDir(): string {
  const dir = path.join(localAppData(), APP_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function chromeProfileDir(): string {
  const dir = path.join(appDataDir(), "chrome-profile");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function runsDir(): string {
  const dir = path.join(appDataDir(), "runs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function logsDir(): string {
  const dir = path.join(appDataDir(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
