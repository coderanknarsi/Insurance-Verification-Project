// Mirrored from functions/src/types/policy.ts — no firebase-admin dependency

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

export interface DriverInfo {
  firstName?: string;
  lastName?: string;
  fullName?: string;
}
