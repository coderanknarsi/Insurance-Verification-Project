/** Types for carrier credentials — stored encrypted in Firestore */

export interface CarrierCredential {
  carrierId: string;
  carrierName: string;
  /** AES-256-GCM encrypted JSON blob containing username/password */
  encryptedData: string;
  /** IV for AES-256-GCM (hex encoded) */
  iv: string;
  /** Auth tag for AES-256-GCM (hex encoded) */
  authTag: string;
  /** When these credentials were last verified working */
  lastVerifiedAt?: string;
  /** Whether these credentials are currently active */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Decrypted credential payload */
export interface CarrierCredentialPayload {
  username: string;
  password: string;
  /** Optional extra fields some portals may need */
  extra?: Record<string, string>;
}
