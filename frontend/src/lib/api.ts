import { httpsCallable } from "firebase/functions";
import { getClientFunctions } from "./firebase";

// ---- Types for Cloud Function inputs/outputs ----

interface CreateVerificationInput {
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
}

interface CreateVerificationResult {
  invitationUrl: string;
  dataRequestId: string;
}

interface SendVerificationLinkInput {
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
  channel: "EMAIL" | "SMS";
}

interface SendVerificationLinkResult {
  invitationUrl: string;
  dataRequestId: string;
  notificationId: string;
  recipient: string;
}

interface GetDashboardSummaryInput {
  organizationId: string;
}

export interface DashboardSummary {
  green: number;
  yellow: number;
  red: number;
  actionRequired: number;
  totalBorrowers: number;
}

interface GetBorrowersInput {
  organizationId: string;
  dashboardStatus?: "GREEN" | "YELLOW" | "RED";
  limit?: number;
  startAfter?: string;
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

export interface PolicyData {
  id: string;
  status: string;
  dashboardStatus: string;
  measureOneDataRequestId?: string;
  policyNumber?: string;
  policyTypes?: string[];
  coveragePeriod?: { startDate: string; endDate: string };
  coverages?: Array<{ type: string; limit?: number; deductible?: number }>;
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
  complianceIssues?: string[];
  lastVerifiedAt?: { _seconds: number; _nanoseconds: number };
}

export interface BorrowerWithVehicles {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  loanNumber: string;
  measureOneIndividualId?: string;
  vehicles: Array<{
    id: string;
    vin: string;
    make: string;
    model: string;
    year: number;
    policy: PolicyData | null;
  }>;
  overallStatus: "GREEN" | "YELLOW" | "RED";
}

interface GetBorrowersResult {
  borrowers: BorrowerWithVehicles[];
  hasMore: boolean;
  lastId: string | null;
}

export interface ComplianceRules {
  requireLienholder: boolean;
  requireComprehensive: boolean;
  requireCollision: boolean;
  maxCompDeductible?: number;
  maxCollisionDeductible?: number;
  expirationWarningDays: number;
  lapseGracePeriodDays: number;
  autoSendReminder: boolean;
  reminderDaysBeforeExpiry: number;
}

export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  performedBy: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  timestamp: { _seconds: number; _nanoseconds: number };
}

// ---- Callable function wrappers ----

export function callCreateVerificationRequest(data: CreateVerificationInput) {
  return httpsCallable<CreateVerificationInput, CreateVerificationResult>(
    getClientFunctions(),
    "createVerificationRequest"
  )(data);
}

export function callSendVerificationLink(data: SendVerificationLinkInput) {
  return httpsCallable<SendVerificationLinkInput, SendVerificationLinkResult>(
    getClientFunctions(),
    "sendVerificationLink"
  )(data);
}

export function callGetDashboardSummary(data: GetDashboardSummaryInput) {
  return httpsCallable<GetDashboardSummaryInput, DashboardSummary>(
    getClientFunctions(),
    "getDashboardSummary"
  )(data);
}

export function callGetBorrowers(data: GetBorrowersInput) {
  return httpsCallable<GetBorrowersInput, GetBorrowersResult>(
    getClientFunctions(),
    "getBorrowers"
  )(data);
}

export function callGetBorrowerAuditLog(data: {
  organizationId: string;
  borrowerId: string;
}) {
  return httpsCallable<typeof data, { entries: AuditLogEntry[] }>(
    getClientFunctions(),
    "getBorrowerAuditLog"
  )(data);
}

export function callGetComplianceRules(data: { organizationId: string }) {
  return httpsCallable<typeof data, ComplianceRules>(
    getClientFunctions(),
    "getComplianceRules"
  )(data);
}

export function callUpdateComplianceRules(data: {
  organizationId: string;
  rules: ComplianceRules;
}) {
  return httpsCallable<typeof data, { success: boolean }>(
    getClientFunctions(),
    "updateComplianceRules"
  )(data);
}
