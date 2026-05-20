/**
 * Diagnostic: list every Gmail mailbox and search each for recent
 * State Farm OTP emails. Useful for confirming whether mail is landing
 * in Spam/All Mail and being missed by INBOX-only polling.
 */
import { ImapFlow } from "imapflow";

async function main() {
  const user = process.env.IMAP_USER!;
  const pass = process.env.IMAP_APP_PASSWORD!;
  if (!user || !pass) {
    throw new Error("IMAP_USER / IMAP_APP_PASSWORD not set");
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  console.log(`Connected as ${user}`);

  const boxes = await client.list();
  console.log("\nMailboxes:");
  for (const b of boxes) {
    console.log(` - ${b.path} (${b.specialUse ?? ""})`);
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const b of boxes) {
    let lock;
    try {
      lock = await client.getMailboxLock(b.path);
    } catch (err) {
      console.log(`\n[${b.path}] skip: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    try {
      const msgs = client.fetch(
        { since },
        { envelope: true, uid: true, internalDate: true },
      );
      const hits: string[] = [];
      for await (const m of msgs) {
        const from = m.envelope?.from?.[0]?.address ?? "";
        const subject = m.envelope?.subject ?? "";
        if (/statefarm|state\s*farm/i.test(from) || /state\s*farm|verification/i.test(subject)) {
          hits.push(
            `   uid=${m.uid} date=${m.internalDate?.toISOString?.() ?? m.internalDate} from=${from} subject=${subject}`,
          );
        }
      }
      console.log(`\n[${b.path}] ${hits.length} potential State Farm hits in last 24h`);
      hits.forEach((h) => console.log(h));
    } finally {
      lock.release();
    }
  }

  await client.logout();
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
