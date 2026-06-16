import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import * as crypto from "crypto";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { requireSuperAdmin } from "../middleware/auth";
import { generateApiKey, hashApiKey } from "../middleware/api-key";

/**
 * Super-admin management of partner API keys (see middleware/api-key.ts).
 * Keys let external systems (DMS, CRM) call the partner REST API on behalf
 * of one organization. The raw key is returned ONCE at creation; only its
 * sha256 hash is stored.
 */

interface IssueApiKeyRequest {
  organizationId: string;
  label?: string;
  mode?: "live" | "test";
}

export const issuePartnerApiKey = onCall(
  { region: "us-central1", timeoutSeconds: 20, memory: "256MiB" },
  async (request) => {
    requireSuperAdmin(request);

    const data = request.data as IssueApiKeyRequest | undefined;
    if (!data?.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required");
    }

    const orgSnap = await collections.organizations.doc(data.organizationId).get();
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", `Organization ${data.organizationId} not found`);
    }

    const mode = data.mode === "test" ? "test" : "live";
    const { keyId, rawKey, prefix } = generateApiKey(mode);
    await db.collection("apiKeys").doc(keyId).set({
      organizationId: data.organizationId,
      hashedKey: hashApiKey(rawKey),
      prefix,
      label: data.label ?? "",
      mode,
      createdAt: Timestamp.now(),
      createdBy: request.auth?.uid ?? "unknown",
      lastUsedAt: null,
      revokedAt: null,
    });

    logger.info(
      `[partner-api] Issued ${mode} API key ${keyId} (${prefix}…) for org ${data.organizationId}`,
    );

    // rawKey is shown once and never persisted.
    return { keyId, rawKey, prefix, mode };
  },
);

interface RevokeApiKeyRequest {
  keyId: string;
}

export const revokePartnerApiKey = onCall(
  { region: "us-central1", timeoutSeconds: 20, memory: "256MiB" },
  async (request) => {
    requireSuperAdmin(request);

    const data = request.data as RevokeApiKeyRequest | undefined;
    if (!data?.keyId) {
      throw new HttpsError("invalid-argument", "keyId is required");
    }

    const ref = db.collection("apiKeys").doc(data.keyId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", `API key ${data.keyId} not found`);
    }

    await ref.update({ revokedAt: Timestamp.now() });
    logger.info(`[partner-api] Revoked API key ${data.keyId}`);
    return { ok: true };
  },
);

export const listPartnerApiKeys = onCall(
  { region: "us-central1", timeoutSeconds: 20, memory: "256MiB" },
  async (request) => {
    requireSuperAdmin(request);

    const data = request.data as { organizationId?: string } | undefined;
    let query: FirebaseFirestore.Query = db.collection("apiKeys");
    if (data?.organizationId) {
      query = query.where("organizationId", "==", data.organizationId);
    }
    const snap = await query.get();
    const keys = snap.docs.map((d) => {
      const k = d.data();
      return {
        keyId: d.id,
        organizationId: k.organizationId,
        prefix: k.prefix,
        label: k.label ?? "",
        mode: k.mode ?? "live",
        createdAt: k.createdAt?.toDate?.()?.toISOString?.() ?? null,
        lastUsedAt: k.lastUsedAt?.toDate?.()?.toISOString?.() ?? null,
        revoked: !!k.revokedAt,
      };
    });
    return { keys };
  },
);

interface SetWebhookConfigRequest {
  organizationId: string;
  /** Partner endpoint to receive policy.verification.updated events. Empty string clears. */
  webhookUrl?: string;
  /** Shared HMAC secret. Generated server-side when omitted and a URL is set. */
  webhookSecret?: string;
}

export const setPartnerWebhookConfig = onCall(
  { region: "us-central1", timeoutSeconds: 20, memory: "256MiB" },
  async (request) => {
    requireSuperAdmin(request);

    const data = request.data as SetWebhookConfigRequest | undefined;
    if (!data?.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required");
    }
    const orgRef = collections.organizations.doc(data.organizationId);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", `Organization ${data.organizationId} not found`);
    }

    if (!data.webhookUrl) {
      await orgRef.update({
        integration: FieldValue.delete(),
        updatedAt: Timestamp.now(),
      } as FirebaseFirestore.UpdateData<unknown>);
      logger.info(`[partner-api] Cleared webhook config for org ${data.organizationId}`);
      return { ok: true, cleared: true };
    }

    if (!/^https:\/\//i.test(data.webhookUrl)) {
      throw new HttpsError("invalid-argument", "webhookUrl must be an https:// URL");
    }

    const webhookSecret =
      data.webhookSecret || crypto.randomBytes(32).toString("base64url");
    await orgRef.update({
      integration: {
        webhookUrl: data.webhookUrl,
        webhookSecret,
      },
      updatedAt: Timestamp.now(),
    } as FirebaseFirestore.UpdateData<unknown>);

    logger.info(
      `[partner-api] Set webhook config for org ${data.organizationId} → ${data.webhookUrl}`,
    );
    // Secret returned once so it can be shared with the partner.
    return { ok: true, webhookUrl: data.webhookUrl, webhookSecret };
  },
);
