// Quick script to read and decode OTP emails
require("dotenv").config({ path: ".env" });
const { ImapFlow } = require("imapflow");

(async () => {
  const c = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_APP_PASSWORD },
    logger: false,
  });

  await c.connect();
  console.log("connected");
  const l = await c.getMailboxLock("INBOX");

  try {
    let n = 0;
    for await (const m of c.fetch(
      { from: "support_prove@otp.progressive.com" },
      { source: true, uid: true }
    )) {
      n++;
      if (n < 4) continue; // skip older emails, get the latest

      const raw = m.source?.toString("utf-8") || "";
      console.log("UID:", m.uid);

      // Show content-type and encoding headers
      const ctHeaders = raw.match(/Content-T[^\n]+/gi);
      console.log("Content headers:", ctHeaders);

      // Find the code using our known working pattern
      const codeFromTag = raw.match(/>\s*(\d{6})\s*</);
      console.log("Code (tag pattern):", codeFromTag?.[1]);

      // Show 500 chars around the code
      if (codeFromTag) {
        const idx = raw.indexOf(codeFromTag[0]);
        console.log("\n--- Context around code ---");
        console.log(raw.substring(Math.max(0, idx - 300), idx + 200));
        console.log("--- End context ---\n");
      }

      // Also try quoted-printable decode
      const qpMatch = raw.match(
        /Content-Transfer-Encoding: quoted-printable\r?\n\r?\n([\s\S]*?)(?:\r?\n--)/
      );
      if (qpMatch) {
        const decoded = qpMatch[1].replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        const qpCode = decoded.match(/>(\d{6})</);
        console.log("QP decoded code:", qpCode?.[1]);
      }
      break;
    }
  } finally {
    l.release();
  }
  await c.logout();
  console.log("\ndone");
})().catch((e) => console.error(e.message));
