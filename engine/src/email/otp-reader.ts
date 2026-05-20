import { ImapFlow } from "imapflow";

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 360_000;
const CARRIER_POLL_TIMEOUT_MS: Record<string, number> = {
  state_farm: 300_000,
};

/** OTP email sender search terms by carrier */
const OTP_SENDERS: Record<string, string> = {
  progressive: "support_prove@otp.progressive.com",
  state_farm: "statefarm",
  allstate: "allstate@service01.email-allstate.com",
};

export function getOtpPollTimeoutMs(carrierId: string): number {
  return CARRIER_POLL_TIMEOUT_MS[carrierId] ?? DEFAULT_POLL_TIMEOUT_MS;
}

function decodeQuotedPrintable(body: string): string {
  return body
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export function extractOtpCodeFromEmail(body: string, carrierId: string): string | null {
  const decodedBody = decodeQuotedPrintable(body);
  const htmlStart = decodedBody.indexOf("<html");
  const htmlBody = htmlStart >= 0 ? decodedBody.substring(htmlStart) : decodedBody;
  const textBody = htmlBody
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (carrierId === "state_farm") {
    const stateFarmMatch =
      textBody.match(/code you requested[\s\S]{0,200}?((?:\d\s*){8})/i) ??
      textBody.match(/verify your identity[\s\S]{0,200}?((?:\d\s*){8})/i) ??
      textBody.match(/\b((?:\d\s*){8})\b/);

    const code = stateFarmMatch?.[1]?.replace(/\D/g, "") ?? null;
    return code && code.length === 8 ? code : null;
  }

  const match =
    htmlBody.match(/>\s*(\d{6})\s*</) ??
    textBody.match(/Verification Code[\s\S]{0,80}?(\d{6})/i) ??
    textBody.match(/\b(\d{6})\b/);

  return match?.[1] ?? null;
}

/**
 * Connects to the configured IMAP mailbox (Gmail via App Password),
 * polls for an OTP email from the given carrier, extracts the 6-digit code,
 * and deletes the email after reading.
 *
 * Uses a single persistent IMAP connection for the entire polling window
 * to avoid connection overhead and Gmail rate-limiting.
 *
 * Returns the OTP code string, or null if none found within timeout.
 */
export async function fetchOtpCode(
  carrierId: string,
  /** Only consider emails received after this timestamp */
  sinceTimestamp?: Date,
  timeoutMs = getOtpPollTimeoutMs(carrierId),
): Promise<string | null> {
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_APP_PASSWORD;

  if (!user || !pass) {
    console.error("[otp-reader] IMAP_USER or IMAP_APP_PASSWORD not configured");
    return null;
  }

  const senderAddress = OTP_SENDERS[carrierId];
  if (!senderAddress) {
    console.error(`[otp-reader] No OTP sender configured for carrier: ${carrierId}`);
    return null;
  }

  const since = sinceTimestamp ?? new Date(Date.now() - 5 * 60 * 1000);
  const deadline = Date.now() + timeoutMs;

  console.log(
    `[otp-reader] Polling for OTP from ${senderAddress} ` +
    `(timeout ${timeoutMs / 1000}s, since ${since.toISOString()})`
  );

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    console.log("[otp-reader] IMAP connected");

    // Gmail puts unfamiliar senders (including State Farm B2B OTPs) in the
    // Spam folder, which is NOT included in INBOX searches. We poll both.
    const MAILBOXES_TO_SCAN = ["INBOX", "[Gmail]/Spam"] as const;

    const scanMailbox = async (
      mailbox: string,
    ): Promise<{ otpCode: string; matchedUid: number; mailbox: string } | null> => {
      let lock;
      try {
        lock = await client.getMailboxLock(mailbox);
      } catch (err) {
        // Mailbox may not exist (e.g. non-Gmail providers). Skip silently.
        console.log(
          `[otp-reader]   mailbox ${mailbox} unavailable: ${
            err instanceof Error ? err.message : err
          }`,
        );
        return null;
      }

      try {
        // Gmail's server-side `SEARCH FROM` is unreliable on freshly arrived
        // mail in long-lived sessions (returns 0 hits even when the message
        // is in the mailbox). Fetch by `since` only and filter by sender on
        // the client side.
        const messages = client.fetch(
          { since },
          { source: true, uid: true, internalDate: true, envelope: true },
        );

        let otpCode: string | null = null;
        let matchedUid: number | null = null;
        let emailCount = 0;
        let scannedCount = 0;

        const senderMatch = senderAddress.toLowerCase();

        for await (const msg of messages) {
          scannedCount++;
          const fromAddr = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
          const subject = (msg.envelope?.subject ?? "").toLowerCase();
          if (!fromAddr.includes(senderMatch) && !subject.includes(senderMatch)) {
            continue;
          }
          emailCount++;
          const internalDate =
            msg.internalDate instanceof Date
              ? msg.internalDate
              : msg.internalDate
                ? new Date(msg.internalDate)
                : null;
          if (internalDate && internalDate.getTime() < since.getTime()) {
            console.log(
              `[otp-reader]   ${mailbox} uid=${msg.uid}: stale (internalDate=${internalDate.toISOString()} < since=${since.toISOString()}), deleting`,
            );
            try {
              await client.messageDelete({ uid: msg.uid }, { uid: true });
            } catch {
              /* ignore */
            }
            continue;
          }
          if (!msg.source) {
            console.log(`[otp-reader]   ${mailbox} uid=${msg.uid}: no source`);
            continue;
          }
          const body = msg.source.toString("utf-8");
          const extractedCode = extractOtpCodeFromEmail(body, carrierId);

          if (extractedCode) {
            otpCode = extractedCode;
            matchedUid = msg.uid;
            console.log(
              `[otp-reader]   ${mailbox} uid=${msg.uid}: matched code=${otpCode}`,
            );
          } else {
            console.log(
              `[otp-reader]   ${mailbox} uid=${msg.uid}: no code found (body ${body.length} bytes)`,
            );
          }
        }

        console.log(
          `[otp-reader] Poll #${pollCount} ${mailbox}: scanned ${scannedCount}, ${emailCount} from sender "${senderAddress}"`,
        );

        if (otpCode && matchedUid !== null) {
          return { otpCode, matchedUid, mailbox };
        }
        return null;
      } finally {
        lock.release();
      }
    };

    let pollCount = 0;
    while (Date.now() < deadline) {
      pollCount++;
      // Re-select the mailbox each poll so newly arrived messages are visible.
      // Long-lived Gmail sessions otherwise return stale snapshots.
      try {
        await client.mailboxClose();
      } catch {
        /* ignore — no mailbox open yet on first iteration */
      }

      let found: { otpCode: string; matchedUid: number; mailbox: string } | null = null;
      for (const mailbox of MAILBOXES_TO_SCAN) {
        found = await scanMailbox(mailbox);
        if (found) break;
      }

      if (found) {
        try {
          await client.getMailboxLock(found.mailbox).then(async (lock) => {
            try {
              await client.messageDelete({ uid: found!.matchedUid }, { uid: true });
            } finally {
              lock.release();
            }
          });
        } catch (err) {
          console.warn(
            `[otp-reader] Failed to delete OTP email uid=${found.matchedUid} in ${found.mailbox}:`,
            err instanceof Error ? err.message : err,
          );
        }
        console.log(
          `[otp-reader] Found OTP code: ${found.otpCode} in ${found.mailbox} (uid=${found.matchedUid})`,
        );
        return found.otpCode;
      }

      if (Date.now() + POLL_INTERVAL_MS < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  } catch (err) {
    console.error("[otp-reader] IMAP error:", err instanceof Error ? err.message : err);
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
    try { await client.close(); } catch { /* ignore */ }
  }

  console.error("[otp-reader] Timed out waiting for OTP email");
  return null;
}
