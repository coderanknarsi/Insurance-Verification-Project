import { ImapFlow } from "imapflow";

async function main() {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_APP_PASSWORD! },
    logger: false,
  });
  await client.connect();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  console.log("--- new strategy: since-only + JS sender filter + re-SELECT each poll ---");
  for (let i = 1; i <= 5; i++) {
    try { await client.mailboxClose(); } catch {}
    const lock = await client.getMailboxLock("INBOX");
    try {
      let scanned = 0, matched = 0;
      for await (const msg of client.fetch({ since }, { uid: true, envelope: true })) {
        scanned++;
        const from = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const subj = (msg.envelope?.subject ?? "").toLowerCase();
        if (from.includes("statefarm") || subj.includes("statefarm")) matched++;
      }
      console.log(`  poll ${i}: scanned=${scanned} matched=${matched}`);
    } finally { lock.release(); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await client.logout();
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
