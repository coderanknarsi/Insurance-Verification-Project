import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { createCipheriv, randomBytes } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { requireSuperAdmin } from "../middleware/auth";

const credentialEncryptionKey = defineString("CREDENTIAL_ENCRYPTION_KEY");
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = credentialEncryptionKey.value();
  if (hex.length !== 64) {
    throw new HttpsError("internal", "Encryption key misconfigured");
  }
  return Buffer.from(hex, "hex");
}

interface SaveMasterCredentialInput {
  carrierId: string;
  carrierName: string;
  username: string;
  password: string;
}

/**
 * Saves encrypted master carrier portal credentials.
 * Only the platform super admin can call this.
 * Stored globally at masterCredentials/{carrierId} — shared across all orgs.
 */
export const saveMasterCredential = onCall(async (request) => {
  requireSuperAdmin(request);

  const data = request.data as SaveMasterCredentialInput;

  if (!data.carrierId || !data.carrierName || !data.username || !data.password) {
    throw new HttpsError("invalid-argument", "All fields are required.");
  }

  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify({ username: data.username, password: data.password });
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  const now = Timestamp.now();
  await db.collection("masterCredentials").doc(data.carrierId).set({
    carrierId: data.carrierId,
    carrierName: data.carrierName,
    encryptedData: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  return { success: true, carrierId: data.carrierId };
});

/**
 * Lists all master carrier credentials (metadata only, not decrypted).
 * Only the platform super admin can call this.
 */
export const getMasterCredentials = onCall(async (request) => {
  requireSuperAdmin(request);

  const snap = await db.collection("masterCredentials").get();

  const credentials = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      carrierId: d.carrierId,
      carrierName: d.carrierName,
      active: d.active,
      lastVerifiedAt: d.lastVerifiedAt ?? null,
      createdAt: d.createdAt,
    };
  });

  return { credentials };
});

/**
 * Deletes master carrier credentials.
 * Only the platform super admin can call this.
 */
export const deleteMasterCredential = onCall(async (request) => {
  requireSuperAdmin(request);

  const data = request.data as { carrierId: string };

  if (!data.carrierId) {
    throw new HttpsError("invalid-argument", "carrierId is required.");
  }

  await db.collection("masterCredentials").doc(data.carrierId).delete();

  return { success: true };
});
