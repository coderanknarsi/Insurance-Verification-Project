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

export interface CoveragePeriod {
  startDate: string;
  endDate: string;
}

export interface Coverage {
  type: string;
  limit?: number;
  deductible?: number;
}

export interface Policy {
  id?: string;
  vehicleId: string;
  borrowerId: string;
  organizationId: string;
  measureOneDataRequestId?: string;
  status: PolicyStatus;
  policyNumber?: string;
  policyTypes?: string[];
  coveragePeriod?: CoveragePeriod;
  coverages?: Coverage[];
  isLienholderListed?: boolean;
  insuranceProvider?: string;
  dashboardStatus: DashboardStatus;
  lastVerifiedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
