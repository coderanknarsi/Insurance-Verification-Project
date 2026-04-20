import { Firestore } from "@google-cloud/firestore";
import type { CarrierCredential, CarrierCredentialPayload } from "../types/credentials.js";
import { decryptCredential } from "./crypto.js";

let db: Firestore | null = null;

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
  const doc = await getDb()
    .collection("masterCredentials")
    .doc(carrierId)
    .get();

  if (!doc.exists) return null;

  const credential = doc.data() as CarrierCredential;
  if (!credential.active) return null;

  return decryptCredential(credential);
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
