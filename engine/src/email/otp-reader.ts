import { ImapFlow } from "imapflow";

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 360_000;

/** OTP email sender addresses by carrier */
const OTP_SENDERS: Record<string, string> = {
  progressive: "support_prove@otp.progressive.com",
  state_farm: "no-reply@c1.statefarm",
  allstate: "allstate@service01.email-allstate.com",
};

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
  sinceTimestamp?: Date
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
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  console.log(
    `[otp-reader] Polling for OTP from ${senderAddress} ` +
    `(timeout ${POLL_TIMEOUT_MS / 1000}s, since ${since.toISOString()})`
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

    let pollCount = 0;
    while (Date.now() < deadline) {
      pollCount++;
      // NOOP forces the server to send any pending EXISTS/RECENT
      // notifications so we see newly arrived mail on this connection.
      await client.noop();
      const lock = await client.getMailboxLock("INBOX");

      try {
        const messages = client.fetch(
          { from: senderAddress, since },
          { source: true, uid: true }
        );

        let otpCode: string | null = null;
        let matchedUid: number | null = null;
        let emailCount = 0;

        for await (const msg of messages) {
          emailCount++;
          if (!msg.source) {
            console.log(`[otp-reader]   uid=${msg.uid}: no source`);
            continue;
          }
          const body = msg.source.toString("utf-8");

          // Try multiple regex patterns in order of specificity:
          // 1. HTML-wrapped 6-digit code: >123456<
          // 2. Near "Verification Code" text
          // 3. Any 6-digit number in the HTML body (skip MIME headers first)
          const htmlStart = body.indexOf("<html");
          const htmlBody = htmlStart >= 0 ? body.substring(htmlStart) : body;

          const match =
            htmlBody.match(/>\s*(\d{6})\s*</) ??
            htmlBody.match(/Verification Code[\s\S]{0,80}?(\d{6})/i) ??
            htmlBody.match(/\b(\d{6})\b/);

          if (match) {
            otpCode = match[1];
            matchedUid = msg.uid;
            console.log(`[otp-reader]   uid=${msg.uid}: matched code=${otpCode}`);
            // Don't break — keep scanning to find the newest email (highest UID)
          } else {
            console.log(`[otp-reader]   uid=${msg.uid}: no code found (body ${body.length} bytes)`);
          }
        }

        console.log(`[otp-reader] Poll #${pollCount}: ${emailCount} emails from sender`);

        if (otpCode && matchedUid) {
          // Delete the OTP email to keep inbox clean
          await client.messageDelete({ uid: matchedUid }, { uid: true });
          console.log(`[otp-reader] Found OTP code: ${otpCode}, deleted email uid=${matchedUid}`);
          return otpCode;
        }
      } finally {
        lock.release();
      }

      // Wait before polling again
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
