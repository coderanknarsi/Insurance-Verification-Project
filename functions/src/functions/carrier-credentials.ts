import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { createCipheriv, randomBytes } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { UserRole } from "../types/user";

const credentialEncryptionKey = defineString("CREDENTIAL_ENCRYPTION_KEY");
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = credentialEncryptionKey.value();
  if (hex.length !== 64) {
    throw new HttpsError("internal", "Encryption key misconfigured");
  }
  return Buffer.from(hex, "hex");
}

interface SaveCredentialInput {
  organizationId: string;
  carrierId: string;
  carrierName: string;
  username: string;
  password: string;
}

interface GetCredentialsInput {
  organizationId: string;
}

/**
 * Saves encrypted carrier portal credentials for an organization.
 * Only org admins can call this.
 */
export const saveCarrierCredential = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as SaveCredentialInput;

  if (!data.organizationId || !data.carrierId || !data.carrierName || !data.username || !data.password) {
    throw new HttpsError("invalid-argument", "All fields are required.");
  }

  requireRole(user, UserRole.ADMIN);
  requireOrg(user, data.organizationId);

  // Encrypt the credentials
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify({ username: data.username, password: data.password });
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  const now = Timestamp.now();
  await db
    .collection("organizations")
    .doc(data.organizationId)
    .collection("carrierCredentials")
    .doc(data.carrierId)
    .set({
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
 * Lists carrier credentials for an organization (metadata only, not decrypted).
 */
export const getCarrierCredentials = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as GetCredentialsInput;

  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  requireRole(user, UserRole.ADMIN);
  requireOrg(user, data.organizationId);

  const snap = await db
    .collection("organizations")
    .doc(data.organizationId)
    .collection("carrierCredentials")
    .get();

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
 * Deletes carrier credentials for an organization.
 */
export const deleteCarrierCredential = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as { organizationId: string; carrierId: string };

  if (!data.organizationId || !data.carrierId) {
    throw new HttpsError("invalid-argument", "organizationId and carrierId are required.");
  }

  requireRole(user, UserRole.ADMIN);
  requireOrg(user, data.organizationId);

  await db
    .collection("organizations")
    .doc(data.organizationId)
    .collection("carrierCredentials")
    .doc(data.carrierId)
    .delete();

  return { success: true };
});
