/**
 * Quick diagnostic: connect to IMAP, list recent emails from Progressive OTP sender,
 * and dump their raw content so we can see the actual format.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../../.env") });

import { ImapFlow } from "imapflow";

async function main() {
  const user = process.env.IMAP_USER!;
  const pass = process.env.IMAP_APP_PASSWORD!;
  console.log(`Connecting as ${user}...`);

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");

  try {
    // 1. List ALL recent messages (last 7 days)
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    console.log(`\n=== Searching emails since ${since.toISOString()} ===\n`);

    // First try a broad search for ALL emails
    const allMessages = client.fetch(
      { since },
      { source: true, uid: true, envelope: true }
    );

    let count = 0;
    for await (const msg of allMessages) {
      count++;
      const from = msg.envelope?.from?.[0]?.address ?? "unknown";
      const subject = msg.envelope?.subject ?? "(no subject)";
      const date = msg.envelope?.date?.toISOString() ?? "unknown";
      console.log(`--- Email #${count} (uid=${msg.uid}) ---`);
      console.log(`  From: ${from}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Date: ${date}`);

      if (from.includes("progressive") || from.includes("otp")) {
        console.log(`  *** PROGRESSIVE OTP EMAIL FOUND ***`);
        const body = msg.source?.toString("utf-8") ?? "";
        console.log(`  Raw body length: ${body.length}`);
        // Print just the relevant parts (skip headers-heavy MIME)
        // Find the HTML or text content
        const htmlMatch = body.match(/<html[\s\S]*<\/html>/i);
        if (htmlMatch) {
          console.log(`  HTML content:\n${htmlMatch[0].substring(0, 2000)}`);
        } else {
          // No HTML, show last 1000 chars (likely the text body)
          console.log(`  Body (last 1000 chars):\n${body.substring(body.length - 1000)}`);
        }

        // Test the current regex
        const match1 = body.match(/>\s*(\d{6})\s*</);
        const match2 = body.match(/Verification Code[\s\S]{0,50}?(\d{6})/i);
        const match3 = body.match(/\b(\d{6})\b/);
        console.log(`  Regex '>\\s*(\\d{6})\\s*<': ${match1 ? match1[1] : "NO MATCH"}`);
        console.log(`  Regex 'Verification Code...': ${match2 ? match2[1] : "NO MATCH"}`);
        console.log(`  Regex '\\b(\\d{6})\\b': ${match3 ? match3[1] : "NO MATCH"}`);
      }
      console.log();
    }

    console.log(`\nTotal emails found: ${count}`);

    // 2. Try the exact search the OTP reader uses
    console.log(`\n=== Trying OTP reader search (from: support_prove@otp.progressive.com) ===\n`);
    const otpMessages = client.fetch(
      { from: "support_prove@otp.progressive.com", since },
      { source: true, uid: true }
    );

    let otpCount = 0;
    for await (const msg of otpMessages) {
      otpCount++;
      console.log(`OTP email uid=${msg.uid}, source length=${msg.source?.length ?? 0}`);
    }
    console.log(`OTP sender emails found: ${otpCount}`);

  } finally {
    lock.release();
  }

  await client.logout();
  await client.close();
}

main().catch(console.error);
