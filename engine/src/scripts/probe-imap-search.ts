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
  const lock = await client.getMailboxLock("INBOX");
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const filter of [
      { since },
      { from: "statefarm", since },
      { from: "no-reply@c1.statefarm", since },
      { from: "c1.statefarm", since },
      { subject: "State Farm B2B Portal", since },
      { gmailRaw: "from:statefarm newer_than:1d" },
    ]) {
      let n = 0;
      // @ts-ignore
      for await (const m of client.fetch(filter, { uid: true, envelope: true })) {
        n++;
      }
      console.log(`${JSON.stringify(filter)} -> ${n} msgs`);
    }
  } finally {
    lock.release();
    await client.logout();
    await client.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
