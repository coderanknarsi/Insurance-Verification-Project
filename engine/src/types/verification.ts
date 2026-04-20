import type {
  PolicyStatus,
  CoveragePeriod,
  Coverage,
  InterestedParty,
  DriverInfo,
} from "./policy.js";

/** Input for a single verification check */
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

/** Normalized result from a carrier verification */
export interface VerificationResult {
  success: boolean;
  policyId: string;
  policyStatus: PolicyStatus;
  policyNumber?: string;
  insuranceProvider: string;
  coveragePeriod?: CoveragePeriod;
  coverages?: Coverage[];
  isLienholderListed?: boolean;
  interestedParties?: InterestedParty[];
  drivers?: DriverInfo[];
  rawData?: Record<string, unknown>;
  errorReason?: string;
  agentSteps: number;
  durationMs: number;
}

/** A batch task sent from the dispatcher via Cloud Tasks */
export interface VerificationBatch {
  batchId: string;
  runId: string;
  carrier: string;
  policies: VerificationInput[];
}

/** Response from the worker for a batch */
export interface BatchResult {
  batchId: string;
  runId: string;
  results: VerificationResult[];
  totalDurationMs: number;
}
