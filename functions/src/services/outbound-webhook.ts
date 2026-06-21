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
  changeTypes?: string[];
  changeSummary?: string | null;
  sentAt: string;
}

const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Bounded retry policy. Attempts: immediate, +2s, +8s. Non-2xx responses and
 * network errors (modeled as status 0) are retryable; 2xx is terminal.
 */
export const MAX_WEBHOOK_ATTEMPTS = 3;

/** True when another delivery attempt should be made. */
export function shouldRetry(status: number, attempt: number, max: number): boolean {
  if (status >= 200 && status < 300) return false;
  return attempt < max;
}

/** Delay before the Nth attempt (1-indexed). attempt 1 = 0ms, 2 = 2s, 3 = 8s. */
export function backoffMs(attempt: number): number {
  return [0, 2000, 8000][attempt - 1] ?? 8000;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

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

    // Deliver with bounded retries. Each attempt re-signs nothing (the body and
    // timestamp are fixed for the event); receivers tolerate a small clock skew.
    let status = 0;
    let lastError: string | null = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= MAX_WEBHOOK_ATTEMPTS; attempt += 1) {
      await sleep(backoffMs(attempt));
      attempts = attempt;
      status = 0;
      lastError = null;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
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
        if (!resp.ok) lastError = `HTTP ${resp.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
      }

      if (!shouldRetry(status, attempt, MAX_WEBHOOK_ATTEMPTS)) break;
    }

    const finalStatus = status >= 200 && status < 300 ? status : status || 0;
    await db.collection("webhookDeliveries").add({
      organizationId,
      url,
      event: body.event,
      policyId: payload.policyId,
      httpStatus: status || null,
      finalStatus: finalStatus || null,
      attempts,
      error: lastError,
      lastError,
      createdAt: Timestamp.now(),
    });

    if (lastError) {
      logger.warn("[outbound-webhook] delivery failed", {
        organizationId,
        policyId: payload.policyId,
        attempts,
        error: lastError,
      });
    }
  } catch (err) {
    logger.warn("[outbound-webhook] dispatch error", {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
