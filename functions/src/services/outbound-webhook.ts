import * as crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";

/**
 * Outbound partner webhooks.
 *
 * When a verification result is recorded for a policy, orgs with a configured
 * integration endpoint (`organizations/{id}.integration.webhookUrl` +
 * `.webhookSecret`) receive a signed POST so the partner system (DMS/CRM) can
 * reflect insurance status without polling.
 *
 * Signing mirrors the inbound patterns we verify (Telnyx/Stripe):
 *   X-AutoLien-Timestamp: unix seconds
 *   X-AutoLien-Signature: v1=<hex HMAC-SHA256 of `${timestamp}.${rawBody}`>
 * Receivers must reject stale timestamps (recommended tolerance: 300s).
 *
 * Delivery is BEST-EFFORT and fire-and-forget: a webhook failure must never
 * affect result recording. Outcomes are logged to `webhookDeliveries`.
 */

export interface PolicyStatusWebhookPayload {
  event: "policy.verification.updated";
  policyId: string;
  loanNumber: string | null;
  status: string | null;
  dashboardStatus: string | null;
  complianceIssues: string[];
  isLienholderListed: boolean | null;
  lastVerifiedAt: string | null;
  lastVerificationError: string | null;
  verifiedVia: string;
  sentAt: string;
}

const WEBHOOK_TIMEOUT_MS = 10_000;

export function signWebhookBody(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
}

/**
 * Sends the policy-status webhook for an org if one is configured.
 * Never throws; logs the outcome to `webhookDeliveries`.
 */
export async function dispatchStatusWebhook(
  organizationId: string,
  payload: Omit<PolicyStatusWebhookPayload, "event" | "sentAt">,
): Promise<void> {
  try {
    const orgSnap = await collections.organizations.doc(organizationId).get();
    const integration = (orgSnap.data() as
      | { integration?: { webhookUrl?: string; webhookSecret?: string } }
      | undefined)?.integration;
    const url = integration?.webhookUrl;
    const secret = integration?.webhookSecret;
    if (!url || !secret) return; // No integration configured — nothing to do.

    const body: PolicyStatusWebhookPayload = {
      event: "policy.verification.updated",
      ...payload,
      sentAt: new Date().toISOString(),
    };
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1=${signWebhookBody(secret, timestamp, rawBody)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    let status = 0;
    let error: string | null = null;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AutoLien-Timestamp": timestamp,
          "X-AutoLien-Signature": signature,
        },
        body: rawBody,
        signal: controller.signal,
      });
      status = resp.status;
      if (!resp.ok) error = `HTTP ${resp.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    await db.collection("webhookDeliveries").add({
      organizationId,
      url,
      event: body.event,
      policyId: payload.policyId,
      httpStatus: status || null,
      error,
      createdAt: Timestamp.now(),
    });

    if (error) {
      logger.warn("[outbound-webhook] delivery failed", {
        organizationId,
        policyId: payload.policyId,
        error,
      });
    }
  } catch (err) {
    logger.warn("[outbound-webhook] dispatch error", {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
