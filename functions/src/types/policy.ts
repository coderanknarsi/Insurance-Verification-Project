import { Timestamp } from "firebase-admin/firestore";

export enum PolicyStatus {
  ACTIVE = "ACTIVE",
  EXPIRED = "EXPIRED",
  PENDING_ACTIVATION = "PENDING_ACTIVATION",
  PENDING_CANCELLATION = "PENDING_CANCELLATION",
  PENDING_EXPIRATION = "PENDING_EXPIRATION",
  CANCELLED = "CANCELLED",
  UNVERIFIED = "UNVERIFIED",
  RESCINDED = "RESCINDED",
  NOT_AVAILABLE = "NOT_AVAILABLE",
}

export enum DashboardStatus {
  GREEN = "GREEN",
  YELLOW = "YELLOW",
  RED = "RED",
}

export enum ComplianceIssue {
  MISSING_LIENHOLDER = "MISSING_LIENHOLDER",
  NO_COMPREHENSIVE = "NO_COMPREHENSIVE",
  NO_COLLISION = "NO_COLLISION",
  DEDUCTIBLE_TOO_HIGH = "DEDUCTIBLE_TOO_HIGH",
  POLICY_CANCELLED = "POLICY_CANCELLED",
  POLICY_EXPIRED = "POLICY_EXPIRED",
  PENDING_CANCELLATION = "PENDING_CANCELLATION",
  VIN_MISMATCH = "VIN_MISMATCH",
  VEHICLE_REMOVED = "VEHICLE_REMOVED",
  COVERAGE_EXPIRED = "COVERAGE_EXPIRED",
  EXPIRING_SOON = "EXPIRING_SOON",
  UNVERIFIED = "UNVERIFIED",
  AWAITING_CREDENTIALS = "AWAITING_CREDENTIALS",
}

export interface CoveragePeriod {
  startDate: string;
  endDate: string;
}

export interface Coverage {
  type: string;
  limit?: number;
  deductible?: number;
}

export interface CoverageLimit {
  type: string;
  amount?: number;
  currency?: string;
  text?: string;
}

export interface CoverageDeductible {
  type: string;
  amount?: number;
  currency?: string;
  text?: string;
  isWaiver?: boolean;
}

export interface CoverageItem {
  name?: string;
  type: string;
  premiumAmount?: { currency: string; amount: number };
  limits: CoverageLimit[];
  deductibles: CoverageDeductible[];
}

export interface InterestedParty {
  name: string;
  type: string;
  address?: {
    addr1?: string;
    addr2?: string;
    city?: string;
    state?: string;
    zipcode?: string;
  };
  phone?: string;
  loanNumber?: string;
}

export interface InsuranceProviderDetail {
  name: string;
  naicCode?: string;
  phone?: string;
  address?: {
    addr1?: string;
    city?: string;
    state?: string;
    zipcode?: string;
  };
}

export interface DriverInfo {
  firstName?: string;
  lastName?: string;
  fullName?: string;
}

export interface Policy {
  id?: string;
  vehicleId: string;
  borrowerId: string;
  organizationId: string;
  status: PolicyStatus;
  policyNumber?: string;
  policyTypes?: string[];
  coveragePeriod?: CoveragePeriod;
  coverages?: Coverage[];
  coverageItems?: CoverageItem[];
  interestedParties?: InterestedParty[];
  isLienholderListed?: boolean;
  insuranceProvider?: string;
  insuranceProviderDetail?: InsuranceProviderDetail;
  cancelledDate?: string;
  pendingCancelDate?: string;
  premiumAmount?: { currency: string; amount: number };
  paymentFrequency?: string;
  drivers?: DriverInfo[];
  vehicleRemovedFromPolicy?: boolean;
  complianceIssues?: ComplianceIssue[];
  dashboardStatus: DashboardStatus;
  awaitingCredentials?: boolean;
  insuranceCardUrl?: string;
  lastVerifiedAt?: Timestamp;
  lastVerificationAttempt?: Timestamp;
  lastVerificationError?: string;
  manualReviewRequired?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
