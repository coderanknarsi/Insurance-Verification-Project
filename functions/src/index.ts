// Phase 2: Data Ingestion
export { ingestDealData } from "./functions/ingest-deal-data";
export { bulkImportDeals } from "./functions/bulk-import";
export { getBorrowers, getDashboardSummary } from "./functions/get-borrowers";
export { updateBorrower } from "./functions/update-borrower";
export { deleteBorrower } from "./functions/delete-borrower";

// Auth: User bootstrap
export { getUserProfile } from "./functions/get-user-profile";

// Team Management
export {
  inviteTeamMember,
  getTeamMembers,
  revokeInvite,
  removeTeamMember,
} from "./functions/team-management";

// Webhooks
export { telnyxInboundWebhook } from "./functions/telnyx-inbound-webhook";
export { getVerifications } from "./functions/get-verifications";
export { seedVerificationData } from "./functions/seed-verification-data";

// Phase 5: Audit Log & Compliance Rules
export { getBorrowerAuditLog } from "./functions/get-borrower-audit-log";
export { getComplianceRules, updateComplianceRules } from "./functions/compliance-rules";
export { getOrganizationProfile, updateOrganizationProfile } from "./functions/organization-profile";

// Phase 6: Automated Reminders
export { dailyExpiryReminder } from "./functions/daily-expiry-reminder";
export { dailyLapseAutoRequest } from "./functions/daily-lapse-auto-request";

// Phase 6: Stripe Billing
export {
  createSubscription,
  getSubscriptionStatus,
  changePlan,
  cancelSubscription,
  resumeSubscription,
  createBillingPortalSession,
  getBillingHistory,
  createCheckoutSession,
} from "./functions/stripe-billing";
export { stripeWebhook } from "./functions/stripe-webhook";

// Super Admin
export { getAdminDashboard } from "./functions/admin-dashboard";
export { getAdminOrgDetail } from "./functions/admin-org-detail";
export { deleteOrganization } from "./functions/delete-organization";

// Demo
export { getDemoToken } from "./functions/demo-auth";
export { dailyDemoReset } from "./functions/daily-demo-reset";

// Carrier Credentials (per-org — legacy)
export {
  saveCarrierCredential,
  getCarrierCredentials,
  deleteCarrierCredential,
} from "./functions/carrier-credentials";

// Master Carrier Credentials (Super Admin)
export {
  saveMasterCredential,
  getMasterCredentials,
  deleteMasterCredential,
} from "./functions/master-credentials";

// Data Feed Engine Dispatcher
export { weeklyDataFeedDispatcher } from "./functions/data-feed-dispatcher";

// Borrower Intake (magic link SMS workflow)
export {
  requestBorrowerIntake,
  getIntakeInfo,
  submitBorrowerIntake,
  dealerSubmitInsurance,
} from "./functions/borrower-intake";
