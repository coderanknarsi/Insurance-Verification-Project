// Temporary script to write Progressive credentials to Firestore
const crypto = require("crypto");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "insurance-track-os" });
}
const db = admin.firestore();

async function main() {
  // Step 1: Find the user's org ID
  const userDoc = await db.doc("users/cgjuwhEupZROQbMlMZIUSPgZbWl2").get();
  if (!userDoc.exists) {
    console.log("ERROR: User doc not found");
    process.exit(1);
  }
  const orgId = userDoc.data().organizationId;
  console.log("ORG_ID=" + orgId);

  // Step 2: Encrypt the credentials
  const ALGORITHM = "aes-256-gcm";
  const keyHex = "70cdd9dcceeb3bd58cba836d014784d3378360d04d3be9881e7098fb99e0bad4";
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(16);
  const payload = JSON.stringify({ username: "autoLT", password: "Vikings2!" });
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(payload, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  const now = new Date().toISOString();
  const doc = {
    carrierId: "progressive",
    carrierName: "Progressive",
    encryptedData: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  // Step 3: Write to Firestore
  const path = `organizations/${orgId}/carrierCredentials/progressive`;
  console.log("Writing to: " + path);
  await db.doc(path).set(doc);
  console.log("SUCCESS: Progressive credentials stored");
  process.exit(0);
}

main().catch((err) => {
  console.log("ERROR: " + err.message);
  process.exit(1);
});
