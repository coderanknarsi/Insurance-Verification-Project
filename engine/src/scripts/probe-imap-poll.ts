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
  const since = new Date(Date.now() - 60 * 60 * 1000);

  console.log("\n--- A) NOOP OUTSIDE lock (current code) ---");
  for (let i = 1; i <= 3; i++) {
    await client.noop();
    const lock = await client.getMailboxLock("INBOX");
    try {
      let n = 0;
      for await (const _ of client.fetch({ from: "statefarm", since }, { uid: true })) n++;
      console.log(`  poll ${i}: ${n} msgs`);
    } finally { lock.release(); }
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("\n--- B) NOOP INSIDE lock ---");
  for (let i = 1; i <= 3; i++) {
    const lock = await client.getMailboxLock("INBOX");
    try {
      await client.noop();
      let n = 0;
      for await (const _ of client.fetch({ from: "statefarm", since }, { uid: true })) n++;
      console.log(`  poll ${i}: ${n} msgs`);
    } finally { lock.release(); }
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("\n--- C) mailboxClose + re-lock each poll ---");
  for (let i = 1; i <= 3; i++) {
    try { await client.mailboxClose(); } catch {}
    const lock = await client.getMailboxLock("INBOX");
    try {
      let n = 0;
      for await (const _ of client.fetch({ from: "statefarm", since }, { uid: true })) n++;
      console.log(`  poll ${i}: ${n} msgs`);
    } finally { lock.release(); }
    await new Promise((r) => setTimeout(r, 1500));
  }

  await client.logout();
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
