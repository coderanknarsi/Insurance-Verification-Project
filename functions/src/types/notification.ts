import { Timestamp } from "firebase-admin/firestore";

export enum NotificationType {
  SMS = "SMS",
  EMAIL = "EMAIL",
  PORTAL = "PORTAL",
}

export enum NotificationTrigger {
  // Pre-expiry
  EXPIRING_SOON = "EXPIRING_SOON",

  // Lapse cadence (status = CANCELLED / EXPIRED)
  LAPSE_DETECTED = "LAPSE_DETECTED",        // T+1 first notice (handled by daily-lapse-auto-request)
  LAPSED_SECOND_NOTICE = "LAPSED_SECOND_NOTICE", // T+10
  LAPSED_FINAL_NOTICE = "LAPSED_FINAL_NOTICE",   // T+20 — CPI/repo warning
  LAPSE_CURED = "LAPSE_CURED",              // proof received

  // Coverage cadence (active policy, but deductible too high / lienholder missing / etc)
  COVERAGE_FIRST_NOTICE = "COVERAGE_FIRST_NOTICE",   // T+1
  COVERAGE_SECOND_NOTICE = "COVERAGE_SECOND_NOTICE", // T+14
  COVERAGE_FINAL_NOTICE = "COVERAGE_FINAL_NOTICE",   // T+30 — CPI/repo warning
  COVERAGE_CURED = "COVERAGE_CURED",

  // Verification system events
  REINSTATEMENT_REMINDER = "REINSTATEMENT_REMINDER",
  VERIFICATION_PROOF_REQUEST = "VERIFICATION_PROOF_REQUEST",

  // Intake flow
  INTAKE_REQUESTED = "INTAKE_REQUESTED",
  /** Follow-up nudge when borrower hasn't submitted yet */
  INTAKE_REMINDER = "INTAKE_REMINDER",
  /** Borrower replied HELP to an intake SMS */
  INTAKE_HELP_REQUESTED = "INTAKE_HELP_REQUESTED",
  DEALER_SUBMITTED = "DEALER_SUBMITTED",
  INTAKE_COMPLETED = "INTAKE_COMPLETED",
  /** Borrower attempted submission but the doc was rejected (VIN/name/expiration mismatch) */
  INTAKE_REJECTED = "INTAKE_REJECTED",
  /** Borrower submission accepted but flagged for manual review (lienholder mismatch, low OCR confidence, etc.) */
  INTAKE_REVIEW_NEEDED = "INTAKE_REVIEW_NEEDED",
}

export enum NotificationStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  FAILED = "FAILED",
  COMPLETED = "COMPLETED",
}

export enum NotificationChannel {
  EMAIL = "EMAIL",
  SMS = "SMS",
}

export interface Notification {
  id?: string;
  borrowerId: string;
  organizationId: string;
  type: NotificationType;
  channel?: NotificationChannel;
  trigger: NotificationTrigger;
  status: NotificationStatus;
  sentAt?: Timestamp;
  content: string;
  messageSid?: string;
  errorCode?: string;
  segments?: number;
  createdAt: Timestamp;
}
