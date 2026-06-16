import * as crypto from "crypto";
import type { Request } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";

/**
 * Partner API keys.
 *
 * Stored in `apiKeys/{keyId}`:
 *   organizationId  - tenant the key writes to (tenant isolation derives the
 *                     org from the key, NEVER from the request body)
 *   hashedKey       - sha256 hex of the raw key (raw key is never stored)
 *   prefix          - first characters of the raw key, for display/support
 *   label           - human-readable name ("Frazer integration")
 *   createdAt / createdBy / lastUsedAt / revokedAt
 *
 * Raw key format: alt_live_<43 chars base64url> (production) or
 * alt_test_<…> (sandbox) — shown once at creation.
 */

export const LIVE_PREFIX = "alt_live_";
export const TEST_PREFIX = "alt_test_";

export type ApiKeyMode = "live" | "test";

/** True when the raw key starts with a recognized AutoLien prefix. */
export function isKnownKeyPrefix(raw: string): boolean {
  return raw.startsWith(LIVE_PREFIX) || raw.startsWith(TEST_PREFIX);
}

/** Map a raw key to its mode. Test keys carry the sandbox prefix; all else is live. */
export function keyMode(raw: string): ApiKeyMode {
  return raw.startsWith(TEST_PREFIX) ? "test" : "live";
}

export interface ApiKeyContext {
  keyId: string;
  organizationId: string;
  label: string;
  mode: ApiKeyMode;
}

export interface GeneratedApiKey {
  keyId: string;
  rawKey: string;
  prefix: string;
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/** Mint a new raw key + Firestore doc fields. Caller persists the doc. */
export function generateApiKey(mode: ApiKeyMode = "live"): GeneratedApiKey {
  const prefix = mode === "test" ? TEST_PREFIX : LIVE_PREFIX;
  const rawKey = prefix + crypto.randomBytes(32).toString("base64url");
  return {
    keyId: db.collection("apiKeys").doc().id,
    rawKey,
    prefix: rawKey.slice(0, prefix.length + 6),
  };
}

export class ApiKeyError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Authenticates a partner REST request via `Authorization: Bearer <key>` or
 * `X-API-Key: <key>`. Returns the key's org context or throws ApiKeyError
 * (401) for the caller to surface as JSON.
 */
export async function requireApiKey(req: Request): Promise<ApiKeyContext> {
  const authHeader = req.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const rawKey = bearer || (req.get("x-api-key") ?? "").trim();

  if (!rawKey) {
    throw new ApiKeyError(401, "Missing API key. Send Authorization: Bearer <key>.");
  }
  if (!isKnownKeyPrefix(rawKey)) {
    throw new ApiKeyError(401, "Invalid API key.");
  }

  const hashed = hashApiKey(rawKey);
  const snap = await db
    .collection("apiKeys")
    .where("hashedKey", "==", hashed)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new ApiKeyError(401, "Invalid API key.");
  }
  const doc = snap.docs[0];
  const data = doc.data();
  if (data.revokedAt) {
    throw new ApiKeyError(401, "API key has been revoked.");
  }
  if (!data.organizationId) {
    throw new ApiKeyError(401, "API key is not bound to an organization.");
  }

  // Best-effort usage stamp; never block the request on it.
  doc.ref
    .update({ lastUsedAt: Timestamp.now() })
    .catch(() => undefined);

  return {
    keyId: doc.id,
    organizationId: data.organizationId as string,
    label: (data.label as string) ?? "",
    mode: (data.mode as ApiKeyMode) ?? keyMode(rawKey),
  };
}
