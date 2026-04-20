import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

admin.initializeApp({ projectId: "insurance-track-os" });
const db = admin.firestore();

async function seedVerifications() {
  console.log("Seeding verification notification records...\n");

  const orgId = "demo-org";

  // Match the existing borrower IDs from the seed data
  const borrowers = [
    { id: "demo-borrower", name: "John Smith" },
    { id: "borrower-maria", name: "Maria Garcia" },
    { id: "borrower-james", name: "James Wilson" },
    { id: "borrower-sarah", name: "Sarah Chen" },
  ];

  // Also look for live borrowers by querying Firestore
  const liveBorrowers = await db
    .collection("borrowers")
    .where("organizationId", "==", orgId)
    .get();

  const allBorrowersMap = new Map<string, string>();
  for (const b of borrowers) allBorrowersMap.set(b.id, b.name);
  for (const doc of liveBorrowers.docs) {
    const d = doc.data();
    allBorrowersMap.set(doc.id, `${d.firstName} ${d.lastName}`);
  }

  const borrowerList = Array.from(allBorrowersMap.entries()).map(([id, name]) => ({
    id,
    name,
  }));

  console.log(`Found ${borrowerList.length} borrowers\n`);

  const now = Date.now();
  const day = 86400000;

  // Generate realistic verification records
  const records = [
    // Recent — today
    {
      borrowerId: borrowerList[0]?.id,
      type: "EMAIL",
      trigger: "LAPSE_DETECTED",
      status: "SENT",
      sentAt: Timestamp.fromMillis(now - 2 * 3600000),
      content: `Insurance verification link sent to john.smith@example.com`,
      createdAt: Timestamp.fromMillis(now - 2 * 3600000),
    },
    // Yesterday
    {
      borrowerId: borrowerList[1]?.id,
      type: "EMAIL",
      trigger: "EXPIRING_SOON",
      status: "SENT",
      sentAt: Timestamp.fromMillis(now - 1 * day),
      content: `Insurance verification link sent to maria.garcia@example.com`,
      createdAt: Timestamp.fromMillis(now - 1 * day),
    },
    // 2 days ago — delivered
    {
      borrowerId: borrowerList[3]?.id,
      type: "EMAIL",
      trigger: "LAPSE_DETECTED",
      status: "DELIVERED",
      sentAt: Timestamp.fromMillis(now - 2 * day),
      content: `Insurance verification link sent to sarah.chen@example.com`,
      createdAt: Timestamp.fromMillis(now - 2 * day),
    },
    // 3 days ago — failed
    {
      borrowerId: borrowerList[2]?.id,
      type: "EMAIL",
      trigger: "LAPSE_DETECTED",
      status: "FAILED",
      content: `Verification email failed for james.wilson@example.com: invalid email`,
      createdAt: Timestamp.fromMillis(now - 3 * day),
    },
    // 4 days ago
    {
      borrowerId: borrowerList[0]?.id,
      type: "EMAIL",
      trigger: "REINSTATEMENT_REMINDER",
      status: "SENT",
      sentAt: Timestamp.fromMillis(now - 4 * day),
      content: `Reinstatement reminder sent to john.smith@example.com`,
      createdAt: Timestamp.fromMillis(now - 4 * day),
    },
    // 5 days ago — SMS pending
    {
      borrowerId: borrowerList[1]?.id,
      type: "SMS",
      trigger: "EXPIRING_SOON",
      status: "PENDING",
      content: `SMS verification link generated for +12145552345`,
      createdAt: Timestamp.fromMillis(now - 5 * day),
    },
    // 1 week ago
    {
      borrowerId: borrowerList[3]?.id,
      type: "EMAIL",
      trigger: "EXPIRING_SOON",
      status: "SENT",
      sentAt: Timestamp.fromMillis(now - 7 * day),
      content: `Insurance verification link sent to sarah.chen@example.com`,
      createdAt: Timestamp.fromMillis(now - 7 * day),
    },
    // 10 days ago
    {
      borrowerId: borrowerList[2]?.id,
      type: "EMAIL",
      trigger: "LAPSE_DETECTED",
      status: "SENT",
      sentAt: Timestamp.fromMillis(now - 10 * day),
      content: `Insurance verification link sent to james.wilson@example.com`,
      createdAt: Timestamp.fromMillis(now - 10 * day),
    },
    // 2 weeks ago — multiple for same borrower
    {
      borrowerId: borrowerList[0]?.id,
      type: "EMAIL",
      trigger: "LAPSE_DETECTED",
      status: "DELIVERED",
      sentAt: Timestamp.fromMillis(now - 14 * day),
      content: `Insurance verification link sent to john.smith@example.com`,
      createdAt: Timestamp.fromMillis(now - 14 * day),
    },
    // 3 weeks ago
    {
      borrowerId: borrowerList[1]?.id,
      type: "EMAIL",
      trigger: "LAPSE_DETECTED",
      status: "SENT",
      sentAt: Timestamp.fromMillis(now - 21 * day),
      content: `Insurance verification link sent to maria.garcia@example.com`,
      createdAt: Timestamp.fromMillis(now - 21 * day),
    },
  ];

  // Also add some for any additional borrowers found in live data
  const extra = borrowerList.slice(4);
  for (let i = 0; i < Math.min(extra.length, 6); i++) {
    const b = extra[i];
    records.push({
      borrowerId: b.id,
      type: "EMAIL",
      trigger: i % 2 === 0 ? "LAPSE_DETECTED" : "EXPIRING_SOON",
      status: i % 3 === 0 ? "SENT" : i % 3 === 1 ? "PENDING" : "FAILED",
      ...(i % 3 === 0
        ? { sentAt: Timestamp.fromMillis(now - (i + 2) * day) }
        : {}),
      content: `Insurance verification link for ${b.name}`,
      createdAt: Timestamp.fromMillis(now - (i + 2) * day),
    });
  }

  // Write all to Firestore
  const batch = db.batch();
  for (const rec of records) {
    if (!rec.borrowerId) continue;
    const ref = db.collection("notifications").doc();
    batch.set(ref, {
      ...rec,
      organizationId: orgId,
    });
  }
  await batch.commit();

  console.log(`  ✓ Created ${records.filter((r) => r.borrowerId).length} verification records\n`);
  console.log("Done!");
}

seedVerifications().catch(console.error);
