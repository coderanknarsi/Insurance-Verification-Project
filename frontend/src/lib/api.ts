import { httpsCallable } from "firebase/functions";
import { getClientFunctions } from "./firebase";

// ---- Types for Cloud Function inputs/outputs ----

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
  awaitingCredentials?: boolean;
  insuranceCardUrl?: string;
}

export interface BorrowerWithVehicles {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  loanNumber: string;
  smsConsentStatus?: "OPTED_IN" | "OPTED_OUT" | "NOT_SET";
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

export type OrganizationType = "BHPH_DEALER" | "BANK" | "CREDIT_UNION" | "FINANCE_COMPANY";

export interface OrganizationProfile {
  name: string;
  type: OrganizationType;
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

export function callGetOrganizationProfile(data: { organizationId: string }) {
  return httpsCallable<typeof data, OrganizationProfile>(
    getClientFunctions(),
    "getOrganizationProfile"
  )(data);
}

export function callUpdateOrganizationProfile(data: {
  organizationId: string;
  name: string;
  type?: OrganizationType;
}) {
  return httpsCallable<typeof data, { success: boolean; name: string; type: OrganizationType }>(
    getClientFunctions(),
    "updateOrganizationProfile"
  )(data);
}

// ---- Stripe Billing ----

export interface SubscriptionStatus {
  hasSubscription: boolean;
  plan: string | null;
  planName: string | null;
  priceMonthly: number | null;
  status: string | null;
  currentPeriodEnd: number | null;
  trialEnd: number | null;
  trialDaysRemaining: number | null;
  cancelAtPeriodEnd: boolean;
  maxVehicles: number;
  activeVehicles: number;
}

export interface CreateSubscriptionResult {
  subscriptionId: string;
  clientSecret: string | null;
  status: string;
  trialEnd: number | null;
}

export function callCreateSubscription(data: {
  organizationId: string;
  plan: string;
}) {
  return httpsCallable<typeof data, CreateSubscriptionResult>(
    getClientFunctions(),
    "createSubscription"
  )(data);
}

export function callGetSubscriptionStatus(data: { organizationId: string }) {
  return httpsCallable<typeof data, SubscriptionStatus>(
    getClientFunctions(),
    "getSubscriptionStatus"
  )(data);
}

export function callChangePlan(data: {
  organizationId: string;
  newPlan: string;
}) {
  return httpsCallable<typeof data, { success: boolean; plan: string; status: string }>(
    getClientFunctions(),
    "changePlan"
  )(data);
}

export function callCancelSubscription(data: { organizationId: string }) {
  return httpsCallable<typeof data, { success: boolean }>(
    getClientFunctions(),
    "cancelSubscription"
  )(data);
}

export function callResumeSubscription(data: { organizationId: string }) {
  return httpsCallable<typeof data, { success: boolean }>(
    getClientFunctions(),
    "resumeSubscription"
  )(data);
}

export function callCreateBillingPortalSession(data: {
  organizationId: string;
  returnUrl: string;
}) {
  return httpsCallable<typeof data, { url: string }>(
    getClientFunctions(),
    "createBillingPortalSession"
  )(data);
}

export interface InvoiceRecord {
  id: string;
  number: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: number;
  periodStart: number;
  periodEnd: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  description: string | null;
}

export function callGetBillingHistory(data: { organizationId: string; limit?: number }) {
  return httpsCallable<typeof data, { invoices: InvoiceRecord[] }>(
    getClientFunctions(),
    "getBillingHistory"
  )(data);
}

export function callCreateCheckoutSession(data: {
  organizationId: string;
  plan?: string;
  mode: "subscription" | "setup";
}) {
  return httpsCallable<typeof data, { clientSecret: string }>(
    getClientFunctions(),
    "createCheckoutSession"
  )(data);
}

// ---- Bulk Import ----

export interface CsvRow {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  loanNumber: string;
  vin: string;
  make?: string;
  model?: string;
  year?: number;
}

export interface BulkImportResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
  warnings?: number;
  results: Array<{
    row: number;
    loanNumber: string;
    status: "created" | "updated" | "error";
    borrowerId?: string;
    vehicleId?: string;
    error?: string;
    warnings?: string[];
  }>;
}

export function callBulkImportDeals(data: {
  organizationId: string;
  rows: CsvRow[];
  smsConsent?: boolean;
}) {
  return httpsCallable<typeof data, BulkImportResult>(
    getClientFunctions(),
    "bulkImportDeals"
  )(data);
}

// ---- Add Single Borrower ----

export interface IngestDealInput {
  organizationId: string;
  borrower: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    loanNumber?: string;
    smsConsent?: boolean;
  };
  vehicle: {
    vin: string;
    make?: string;
    model?: string;
    year?: number;
  };
}

export interface IngestDealResult {
  borrowerId: string;
  vehicleId: string;
  policyId: string;
  isNewBorrower: boolean;
}

export function callIngestDealData(data: IngestDealInput) {
  return httpsCallable<IngestDealInput, IngestDealResult>(
    getClientFunctions(),
    "ingestDealData"
  )(data);
}

// ---- Update / Delete Borrower ----

export function callUpdateBorrower(data: {
  organizationId: string;
  borrowerId: string;
  updates: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    smsConsentStatus?: "OPTED_IN" | "OPTED_OUT" | "NOT_SET";
  };
}) {
  return httpsCallable<typeof data, { success: boolean }>(
    getClientFunctions(),
    "updateBorrower"
  )(data);
}

export function callDeleteBorrower(data: {
  organizationId: string;
  borrowerId: string;
}) {
  return httpsCallable<typeof data, { success: boolean }>(
    getClientFunctions(),
    "deleteBorrower"
  )(data);
}

// ---- Verifications ----

export interface VerificationRecord {
  id: string;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  channel: "EMAIL" | "SMS" | "PORTAL";
  trigger: string;
  status: string;
  content: string;
  createdAt: number;
  sentAt: number | null;
}

export function callGetVerifications(data: { organizationId: string }) {
  return httpsCallable<typeof data, { verifications: VerificationRecord[] }>(
    getClientFunctions(),
    "getVerifications"
  )(data);
}

export function callSeedVerificationData(data: { organizationId: string }) {
  return httpsCallable<typeof data, { created: number }>(
    getClientFunctions(),
    "seedVerificationData"
  )(data);
}

// ─── Team Management ────────────────────────────────────────────

export interface TeamMember {
  id: string;
  email: string;
  displayName: string;
  role: string;
  type: "member";
  createdAt: number;
}

export interface TeamInvite {
  id: string;
  email: string;
  displayName: string;
  role: string;
  type: "invite";
  createdAt: number;
  expiresAt: number;
  invitedBy: string;
}

export function callGetTeamMembers(data: { organizationId: string }) {
  return httpsCallable<typeof data, { members: TeamMember[]; invites: TeamInvite[] }>(
    getClientFunctions(),
    "getTeamMembers"
  )(data);
}

export function callInviteTeamMember(data: {
  organizationId: string;
  email: string;
  role: string;
}) {
  return httpsCallable<typeof data, { inviteId: string; email: string; role: string }>(
    getClientFunctions(),
    "inviteTeamMember"
  )(data);
}

export function callRevokeInvite(data: {
  organizationId: string;
  inviteId: string;
}) {
  return httpsCallable<typeof data, { success: boolean }>(
    getClientFunctions(),
    "revokeInvite"
  )(data);
}

export function callRemoveTeamMember(data: {
  organizationId: string;
  userId: string;
}) {
  return httpsCallable<typeof data, { success: boolean }>(
    getClientFunctions(),
    "removeTeamMember"
  )(data);
}

// ---- Super Admin ----

export interface AdminOrgSummary {
  id: string;
  name: string;
  type: string;
  plan: string;
  subscriptionStatus: string;
  borrowerCount: number;
  vehicleCount: number;
  userCount: number;
  createdAt: number;
}

export interface AdminDashboardData {
  organizations: AdminOrgSummary[];
  totals: {
    organizations: number;
    borrowers: number;
    vehicles: number;
    users: number;
    mrr: number;
    activeSubscriptions: number;
    trialingSubscriptions: number;
  };
  revenue: {
    planBreakdown: { plan: string; priceMonthly: number; count: number; revenue: number }[];
    statusBreakdown: Record<string, number>;
  };
  notifications: {
    sent: number;
    delivered: number;
    failed: number;
    pending: number;
  };
}

export function callGetAdminDashboard() {
  return httpsCallable<Record<string, never>, AdminDashboardData>(
    getClientFunctions(),
    "getAdminDashboard"
  )({});
}

// Org drill-down types
export interface AdminOrgBorrower {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  vehicles: {
    id: string;
    year: number;
    make: string;
    model: string;
    vin: string;
    policy: {
      status: string;
      dashboardStatus: string;
      complianceIssues: string[];
      expirationDate: string | null;
      carrierName: string | null;
      policyNumber: string | null;
    } | null;
  }[];
}

export interface AdminOrgNotification {
  id: string;
  type: string;
  channel: string;
  trigger: string;
  status: string;
  content: string;
  createdAt: number;
}

export interface AdminOrgDetailData {
  borrowers: AdminOrgBorrower[];
  notifications: AdminOrgNotification[];
}

export function callGetAdminOrgDetail(data: { organizationId: string }) {
  return httpsCallable<typeof data, AdminOrgDetailData>(
    getClientFunctions(),
    "getAdminOrgDetail"
  )(data);
}

// Demo
export function callGetDemoToken() {
  return httpsCallable<void, { token: string }>(
    getClientFunctions(),
    "getDemoToken"
  )();
}

// ---- Borrower Intake (magic link workflow) ----

export interface IntakeRequestInput {
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
  policyId: string;
}

export interface IntakeRequestResult {
  token: string;
  intakeUrl: string;
  deliveryMethod: "sms" | "email" | "both";
  delivered: boolean;
  deliveryError: string | null;
}

export function callRequestBorrowerIntake(data: IntakeRequestInput) {
  return httpsCallable<IntakeRequestInput, IntakeRequestResult>(
    getClientFunctions(),
    "requestBorrowerIntake"
  )(data);
}

export interface IntakeInfo {
  status: "PENDING" | "COMPLETED" | "EXPIRED";
  borrowerFirstName: string;
  vehicleLabel: string;
  dealershipName: string;
}

export function callGetIntakeInfo(data: { token: string }) {
  return httpsCallable<{ token: string }, IntakeInfo>(
    getClientFunctions(),
    "getIntakeInfo"
  )(data);
}

export interface IntakeSubmitInput {
  token: string;
  insuranceProvider?: string;
  policyNumber?: string;
  insuranceCardBase64?: string;
}

export function callSubmitBorrowerIntake(data: IntakeSubmitInput) {
  return httpsCallable<IntakeSubmitInput, { success: boolean }>(
    getClientFunctions(),
    "submitBorrowerIntake"
  )(data);
}

// ---- Dealer Submit Insurance ----

export interface DealerSubmitInsuranceInput {
  organizationId: string;
  policyId: string;
  vehicleId: string;
  insuranceProvider?: string;
  policyNumber?: string;
  insuranceCardBase64?: string;
}

export interface DealerSubmitInsuranceResult {
  success: boolean;
  ocrExtracted: boolean;
  provider?: string;
  policyNumber?: string;
}

export function callDealerSubmitInsurance(data: DealerSubmitInsuranceInput) {
  return httpsCallable<DealerSubmitInsuranceInput, DealerSubmitInsuranceResult>(
    getClientFunctions(),
    "dealerSubmitInsurance"
  )(data);
}

// ---- Carrier Credentials ----

interface SaveCarrierCredentialInput {
  organizationId: string;
  carrierId: string;
  carrierName: string;
  username: string;
  password: string;
}

export interface CarrierCredentialMeta {
  carrierId: string;
  carrierName: string;
  active: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
}

export function callSaveCarrierCredential(data: SaveCarrierCredentialInput) {
  return httpsCallable<SaveCarrierCredentialInput, { success: boolean; carrierId: string }>(
    getClientFunctions(),
    "saveCarrierCredential"
  )(data);
}

export function callGetCarrierCredentials(data: { organizationId: string }) {
  return httpsCallable<typeof data, { credentials: CarrierCredentialMeta[] }>(
    getClientFunctions(),
    "getCarrierCredentials"
  )(data);
}

export function callDeleteCarrierCredential(data: { organizationId: string; carrierId: string }) {
  return httpsCallable<typeof data, { success: boolean }>(
    getClientFunctions(),
    "deleteCarrierCredential"
  )(data);
}

// ---- Master Carrier Credentials (Super Admin) ----

interface SaveMasterCredentialInput {
  carrierId: string;
  carrierName: string;
  username: string;
  password: string;
}

export function callSaveMasterCredential(data: SaveMasterCredentialInput) {
  return httpsCallable<SaveMasterCredentialInput, { success: boolean; carrierId: string }>(
    getClientFunctions(),
    "saveMasterCredential"
  )(data);
}

export function callGetMasterCredentials() {
  return httpsCallable<Record<string, never>, { credentials: CarrierCredentialMeta[] }>(
    getClientFunctions(),
    "getMasterCredentials"
  )({});
}

export function callDeleteMasterCredential(data: { carrierId: string }) {
  return httpsCallable<typeof data, { success: boolean }>(
    getClientFunctions(),
    "deleteMasterCredential"
  )(data);
}
