/** Mirrored from engine/src/types/verification.ts for use in Cloud Functions */

export interface VerificationInput {
  policyId: string;
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
  vin: string;
  borrowerLastName: string;
  borrowerFirstName?: string;
  policyNumber?: string;
  insuranceProvider: string;
}

export interface VerificationBatch {
  batchId: string;
  runId: string;
  carrier: string;
  policies: VerificationInput[];
}
