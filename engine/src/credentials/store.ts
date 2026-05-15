import { Firestore } from "@google-cloud/firestore";
import type { CarrierCredential, CarrierCredentialPayload } from "../types/credentials.js";
import { decryptCredential } from "./crypto.js";

let db: Firestore | null = null;

function normalizeCarrierKey(value: string | undefined | null): string {
  return (value ?? "").toLowerCase().trim().replace(/\s+/g, "_");
}

function getDb(): Firestore {
  if (!db) {
    db = new Firestore({
      projectId: process.env.GCP_PROJECT_ID ?? "insurance-track-os",
    });
  }
  return db;
}

/**
 * Fetches and decrypts master carrier credentials.
 * Credentials are stored globally at: masterCredentials/{carrierId}
 */
export async function getCarrierCredentials(
  carrierId: string
): Promise<CarrierCredentialPayload | null> {
  const normalizedCarrierId = normalizeCarrierKey(carrierId);

  // Fast path: exact document id lookup.
  const directDoc = await getDb()
    .collection("masterCredentials")
    .doc(carrierId)
    .get();

  if (directDoc.exists) {
    const credential = directDoc.data() as CarrierCredential;
    if (credential.active) return decryptCredential(credential);
  }

  // Backward-compatible fallback for legacy records whose document id does not
  // match the normalized carrier id exactly.
  const snap = await getDb().collection("masterCredentials").get();
  const match = snap.docs.find((doc) => {
    const data = doc.data() as CarrierCredential;
    const keys = [doc.id, data.carrierId, data.carrierName].map(normalizeCarrierKey);
    return data.active && keys.includes(normalizedCarrierId);
  });

  if (!match) return null;

  return decryptCredential(match.data() as CarrierCredential);
}

/**
 * Lists all active master carrier credentials (without decrypting).
 */
export async function listCarrierCredentials(): Promise<
  Array<{ carrierId: string; carrierName: string; active: boolean }>
> {
  const snap = await getDb()
    .collection("masterCredentials")
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data() as CarrierCredential;
    return {
      carrierId: data.carrierId,
      carrierName: data.carrierName,
      active: data.active,
    };
  });
}
