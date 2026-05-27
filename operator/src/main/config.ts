import * as dotenv from "dotenv";
import path from "node:path";
import { app } from "electron";
import fs from "node:fs";
import type { FirebaseConfig } from "../shared/bridge-types";

let loaded = false;

function loadEnvOnce(): void {
  if (loaded) return;
  loaded = true;

  // Prefer .env next to the app (dev), then next to the resourcesPath (packaged).
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(app.getAppPath(), ".env"),
    path.resolve(app.getAppPath(), "..", ".env"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
  }
  dotenv.config(); // fallback to process env
}

export function readFirebaseConfig(): FirebaseConfig {
  loadEnvOnce();
  const required = [
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_APP_ID",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase config env vars: ${missing.join(", ")}. Copy operator/.env.example to operator/.env and fill in values.`,
    );
  }
  return {
    apiKey: process.env.FIREBASE_API_KEY!,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.FIREBASE_PROJECT_ID!,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.FIREBASE_APP_ID!,
  };
}

export function readChromeDebugPort(): number {
  loadEnvOnce();
  const raw = process.env.CHROME_DEBUG_PORT;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 9222;
}
