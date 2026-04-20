import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { SmsConsentStatus } from "../types/borrower";
import { sendSms } from "../services/telnyx";
import { logger } from "firebase-functions/v2";

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
    await sendSms(
      phoneNumber,
      "AutoLienTracker: Insurance verification alerts. Reply STOP to unsubscribe. For help, contact your dealership or visit autolientracker.com."
    );

    logger.info("HELP response sent", { phone: phoneNumber });
    res.status(200).json({ status: "help-sent" });
    return;
  }

  // Unrecognized message — do nothing (don't spam the user)
  logger.info("Unrecognized inbound SMS, ignoring", { phone: phoneNumber, text: messageText });
  res.status(200).json({ status: "ignored", reason: "unrecognized keyword" });
});
