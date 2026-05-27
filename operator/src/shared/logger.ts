import fs from "node:fs";
import path from "node:path";
import { logsDir } from "./paths";

type Level = "debug" | "info" | "warn" | "error";

const LOG_FILE = path.join(logsDir(), `operator-${new Date().toISOString().slice(0, 10)}.log`);

function write(level: Level, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const line = data === undefined
    ? `${ts} [${level}] ${msg}`
    : `${ts} [${level}] ${msg} ${safeStringify(data)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // swallow file errors; console already has the line
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => write("debug", msg, data),
  info: (msg: string, data?: unknown) => write("info", msg, data),
  warn: (msg: string, data?: unknown) => write("warn", msg, data),
  error: (msg: string, data?: unknown) => write("error", msg, data),
};
