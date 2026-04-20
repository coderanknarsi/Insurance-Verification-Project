import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { CarrierCredential, CarrierCredentialPayload } from "../types/credentials.js";

const ALGORITHM = "aes-256-gcm";

/**
 * Encryption key from environment — must be 32 bytes (64 hex chars).
 * In production, set via Secret Manager → Cloud Run env var.
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY ?? "";
  if (keyHex.length !== 64) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters (32 bytes). " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(keyHex, "hex");
}

/** Encrypt a credential payload into a Firestore-storable record */
export function encryptCredential(
  carrierId: string,
  carrierName: string,
  payload: CarrierCredentialPayload
): Omit<CarrierCredential, "lastVerifiedAt"> {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(payload);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  const now = new Date().toISOString();
  return {
    carrierId,
    carrierName,
    encryptedData: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Decrypt a stored credential record back to username/password */
export function decryptCredential(
  credential: CarrierCredential
): CarrierCredentialPayload {
  const key = getEncryptionKey();
  const iv = Buffer.from(credential.iv, "hex");
  const authTag = Buffer.from(credential.authTag, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(credential.encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return JSON.parse(decrypted) as CarrierCredentialPayload;
}
