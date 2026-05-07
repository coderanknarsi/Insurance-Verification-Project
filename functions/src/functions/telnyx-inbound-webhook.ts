import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { Timestamp } from "firebase-admin/firestore";
import * as crypto from "crypto";
import { collections } from "../config/firestore";
import { db } from "../config/firebase";
import { SmsConsentStatus } from "../types/borrower";
import {
  NotificationType,
  NotificationTrigger,
  NotificationStatus,
} from "../types/notification";
import { sendSms } from "../services/telnyx";
import { logger } from "firebase-functions/v2";

// Telnyx public key (base64) from Messaging Profile → Webhook signing.
// Required in production. If missing, all inbound webhooks are rejected.
const telnyxPublicKey = defineString("TELNYX_PUBLIC_KEY", { default: "" });
// Allow disabling verification only in dev/emulator environments.
const telnyxWebhookEnforce = defineString("TELNYX_WEBHOOK_ENFORCE", {
  default: "true",
});

// Reject webhooks older than this many seconds (replay protection).
const TELNYX_TIMESTAMP_TOLERANCE_SECONDS = 300;

// SubjectPublicKeyInfo DER prefix for raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function buildEd25519PublicKey(rawBase64: string): crypto.KeyObject | null {
  try {
    const raw = Buffer.from(rawBase64, "base64");
    if (raw.length !== 32) return null;
    const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
    return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  } catch (err) {
    logger.error("Failed to parse Telnyx public key", { error: String(err) });
    return null;
  }
}

function verifyTelnyxSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  publicKeyB64: string,
): { ok: true } | { ok: false; reason: string } {
  if (!signatureHeader) return { ok: false, reason: "missing signature header" };
  if (!timestampHeader) return { ok: false, reason: "missing timestamp header" };

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  const ageSeconds = Math.abs(Date.now() / 1000 - ts);
  if (ageSeconds > TELNYX_TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale timestamp" };
  }

  const keyObj = buildEd25519PublicKey(publicKeyB64);
  if (!keyObj) return { ok: false, reason: "invalid public key" };

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureHeader, "base64");
  } catch {
    return { ok: false, reason: "invalid signature encoding" };
  }
  if (signature.length !== 64) {
    return { ok: false, reason: "invalid signature length" };
  }

  const message = Buffer.concat([
    Buffer.from(`${timestampHeader}|`, "utf8"),
    rawBody,
  ]);

  let ok = false;
  try {
    ok = crypto.verify(null, message, keyObj, signature);
  } catch (err) {
    return { ok: false, reason: `verify error: ${String(err)}` };
  }
  return ok ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

/**
 * Telnyx inbound message webhook.
 * Handles STOP (opt-out), START/UNSTOP (opt-in), and HELP keyword responses.
 * Must be registered as the webhook URL in Telnyx Messaging Profile settings.
 *
 * TCPA requires:
 * - STOP → immediately opt out, confirm with a single reply
 * - HELP → reply with support info
 * - START/UNSTOP → re-opt-in
 */
export const telnyxInboundWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // Signature verification — required to ensure request is from Telnyx.
  const enforce = (telnyxWebhookEnforce.value() || "true").toLowerCase() !== "false";
  const publicKeyB64 = telnyxPublicKey.value();
  if (enforce) {
    if (!publicKeyB64) {
      logger.error("Telnyx webhook rejected: TELNYX_PUBLIC_KEY not configured");
      res.status(500).json({ error: "webhook not configured" });
      return;
    }
    const rawBody: Buffer | undefined = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      logger.error("Telnyx webhook rejected: missing rawBody");
      res.status(400).json({ error: "missing body" });
      return;
    }
    const sigHeader = req.header("telnyx-signature-ed25519") || undefined;
    const tsHeader = req.header("telnyx-timestamp") || undefined;
    const result = verifyTelnyxSignature(rawBody, sigHeader, tsHeader, publicKeyB64);
    if (!result.ok) {
      logger.warn("Telnyx webhook signature rejected", { reason: result.reason });
      res.status(401).json({ error: "invalid signature" });
      return;
    }
  } else {
    logger.warn("Telnyx webhook signature enforcement DISABLED (dev only)");
  }

  const payload = req.body?.data?.payload;
  if (!payload) {
    res.status(200).json({ status: "ignored", reason: "no payload" });
    return;
  }

  const { from, text, direction } = payload as {
    from?: { phone_number?: string };
    text?: string;
    direction?: string;
  };

  // Only process inbound messages
  if (direction !== "inbound" || !from?.phone_number || !text) {
    res.status(200).json({ status: "ignored", reason: "not inbound or missing data" });
    return;
  }

  const phoneNumber = from.phone_number;
  const messageText = text.trim().toUpperCase();

  logger.info("Inbound SMS received", { from: phoneNumber, text: messageText });

  // Normalize phone for lookup — strip to digits, find borrowers by phone match
  const digits = phoneNumber.replace(/\D/g, "");
  const phoneVariants = [
    phoneNumber,
    digits,
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null,
    `+${digits}`,
    `+1${digits.length === 10 ? digits : ""}`,
  ].filter(Boolean) as string[];

  // Find all borrowers matching this phone number
  // Firestore doesn't support OR queries on the same field easily,
  // so we query with the most likely formats
  const matchingBorrowers: Array<{ id: string; organizationId: string }> = [];

  for (const variant of [...new Set(phoneVariants)]) {
    const snap = await collections.borrowers
      .where("phone", "==", variant)
      .get();
    for (const doc of snap.docs) {
      if (!matchingBorrowers.some((b) => b.id === doc.id)) {
        matchingBorrowers.push({ id: doc.id, organizationId: doc.data().organizationId });
      }
    }
  }

  if (matchingBorrowers.length === 0) {
    logger.info("No matching borrower found for inbound SMS", { phone: phoneNumber });
    res.status(200).json({ status: "ok", matched: 0 });
    return;
  }

  const now = Timestamp.now();

  if (messageText === "STOP" || messageText === "UNSUBSCRIBE" || messageText === "CANCEL" || messageText === "QUIT") {
    // Opt out ALL matching borrower records
    for (const borrower of matchingBorrowers) {
      await collections.borrowers.doc(borrower.id).update({
        smsConsentStatus: SmsConsentStatus.OPTED_OUT,
        smsOptOutTimestamp: now,
        updatedAt: now,
      });
    }

    // Send single confirmation (TCPA allows one final message after STOP)
    await sendSms(
      phoneNumber,
      "AutoLienTracker: You've been unsubscribed and will no longer receive text messages. Reply START to re-subscribe."
    );

    logger.info("SMS opt-out processed", { phone: phoneNumber, count: matchingBorrowers.length });
    res.status(200).json({ status: "opt-out", matched: matchingBorrowers.length });
    return;
  }

  if (messageText === "START" || messageText === "UNSTOP" || messageText === "SUBSCRIBE") {
    // Opt back in
    for (const borrower of matchingBorrowers) {
      await collections.borrowers.doc(borrower.id).update({
        smsConsentStatus: SmsConsentStatus.OPTED_IN,
        smsOptInTimestamp: now,
        updatedAt: now,
      });
    }

    await sendSms(
      phoneNumber,
      "AutoLienTracker: You've been re-subscribed to insurance verification alerts. Reply STOP to opt out at any time."
    );

    logger.info("SMS opt-in processed", { phone: phoneNumber, count: matchingBorrowers.length });
    res.status(200).json({ status: "opt-in", matched: matchingBorrowers.length });
    return;
  }

  if (messageText === "HELP" || messageText === "INFO") {
    // Create a staff task per matched org and flag the borrower so the
    // automated reminder cadence stops nudging them. Reply with the
    // dealership's name (and phone, if we have it) so the borrower knows
    // who's calling them back.
    const orgIds = [...new Set(matchingBorrowers.map((b) => b.organizationId))];
    const orgDataById = new Map<string, { name?: string; phone?: string }>();
    for (const orgId of orgIds) {
      try {
        const orgSnap = await collections.organizations.doc(orgId).get();
        if (orgSnap.exists) {
          const o = orgSnap.data() as { name?: string; phone?: string };
          orgDataById.set(orgId, o);
        }
      } catch (err) {
        logger.warn("HELP: failed to load org", { orgId, error: String(err) });
      }
    }

    for (const borrower of matchingBorrowers) {
      try {
        const borrowerSnap = await collections.borrowers.doc(borrower.id).get();
        const borrowerData = borrowerSnap.data();
        const borrowerName = borrowerData
          ? `${borrowerData.firstName ?? ""} ${borrowerData.lastName ?? ""}`.trim()
          : "Borrower";

        await collections.borrowers.doc(borrower.id).update({
          needsHelp: true,
          needsHelpAt: now,
          updatedAt: now,
        });

        await db.collection("staffTasks").doc().set({
          organizationId: borrower.organizationId,
          borrowerId: borrower.id,
          type: "BORROWER_HELP_REQUEST",
          status: "OPEN",
          priority: "HIGH",
          title: `${borrowerName || "Borrower"} replied HELP — needs a callback`,
          description: `Inbound SMS from ${phoneNumber}: "${text.trim()}". Borrower asked for help with their insurance verification.`,
          inboundPhone: phoneNumber,
          inboundText: text.trim(),
          createdAt: now,
          updatedAt: now,
        });

        await collections.notifications.doc().set({
          organizationId: borrower.organizationId,
          borrowerId: borrower.id,
          type: NotificationType.SMS,
          trigger: NotificationTrigger.INTAKE_HELP_REQUESTED,
          status: NotificationStatus.SENT,
          content: `Borrower replied HELP from ${phoneNumber}`,
          createdAt: now,
          sentAt: now,
        });
      } catch (err) {
        logger.warn("HELP: failed to record task for borrower", {
          borrowerId: borrower.id,
          error: String(err),
        });
      }
    }

    // Build a single reply using the first org's name (most borrowers map
    // to one org; the rare cross-org dup is acceptable for the reply).
    const primaryOrg = orgDataById.get(matchingBorrowers[0].organizationId);
    const orgName = primaryOrg?.name || "Your dealership";
    const orgPhone = primaryOrg?.phone ? ` or call ${primaryOrg.phone}` : "";
    const replyText =
      `${orgName}: Thanks for reaching out${orgPhone}. ` +
      `Someone from our team will follow up shortly to help with your insurance info. ` +
      `Reply STOP to opt out.`;
    await sendSms(phoneNumber, replyText);

    logger.info("HELP response sent", {
      phone: phoneNumber,
      tasksCreated: matchingBorrowers.length,
    });
    res.status(200).json({
      status: "help-sent",
      tasksCreated: matchingBorrowers.length,
    });
    return;
  }

  // Unrecognized message — do nothing (don't spam the user)
  logger.info("Unrecognized inbound SMS, ignoring", { phone: phoneNumber, text: messageText });
  res.status(200).json({ status: "ignored", reason: "unrecognized keyword" });
});
