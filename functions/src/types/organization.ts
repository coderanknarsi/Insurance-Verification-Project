import { Timestamp } from "firebase-admin/firestore";
import type { StripeSubscriptionData } from "./subscription";

export enum OrganizationType {
  BHPH_DEALER = "BHPH_DEALER",
  BANK = "BANK",
  CREDIT_UNION = "CREDIT_UNION",
  FINANCE_COMPANY = "FINANCE_COMPANY",
}

export enum NotificationPreference {
  LENDER_ONLY = "LENDER_ONLY",
  AUTO_NOTIFY_BORROWER = "AUTO_NOTIFY_BORROWER",
}

export enum SubscriptionTier {
  STARTER = "STARTER",
  PROFESSIONAL = "PROFESSIONAL",
  ENTERPRISE = "ENTERPRISE",
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
  /**
   * IANA timezone used to evaluate TCPA-style SMS quiet hours (8 AM – 9 PM local).
   * Defaults to America/Chicago when unset (migration fallback for older orgs).
   */
  timezone?: string;
  /**
   * Lapse escalation cadence (days after lapse first detected).
   * First notice (T+firstNoticeDays) is handled by daily-lapse-auto-request as an
   * intake request; second & final notices come from daily-compliance-escalation.
   */
  lapseEscalation?: {
    firstNoticeDays: number;   // default 1
    secondNoticeDays: number;  // default 10
    finalNoticeDays: number;   // default 20
  };
  /**
   * Coverage cure cadence — for active policies that violate org rules
   * (deductible too high, missing lienholder, etc). Slower tempo than lapse.
   */
  coverageEscalation?: {
    firstNoticeDays: number;   // default 1
    secondNoticeDays: number;  // default 14
    finalNoticeDays: number;   // default 30
  };
  /**
   * Emergency kill-switch. When true, ALL outbound borrower notifications
   * (expiry, lapse, coverage, escalations) are suppressed across the org.
   * Intended for incident response (e.g. data breach, carrier outage causing
   * false positives). NOT a regular configuration option — defaults to false
   * and there is no equivalent "auto-send" opt-in toggle: notifications are
   * the core product. Use sparingly.
   */
  notificationsPaused?: boolean;
  notificationsPausedAt?: Timestamp;
  notificationsPausedReason?: string;
}

/** Defaults applied when org doesn't override. Single source of truth. */
export const DEFAULT_LAPSE_ESCALATION = {
  firstNoticeDays: 1,
  secondNoticeDays: 10,
  finalNoticeDays: 20,
};
export const DEFAULT_COVERAGE_ESCALATION = {
  firstNoticeDays: 1,
  secondNoticeDays: 14,
  finalNoticeDays: 30,
};

export interface OrganizationSettings {
  notificationPreference: NotificationPreference;
  lapseGracePeriodDays: number;
  expirationWarningDays: number;
  complianceRules?: ComplianceRules;
  lienholderName?: string;
  /**
   * Day of week (1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri) when this org's
   * portfolio is verified against carrier portals. When unset, derived
   * from a stable hash of the org id. Admins can override via Settings.
   */
  verificationDayOfWeek?: 1 | 2 | 3 | 4 | 5;
}

export interface OrganizationSubscription {
  tier: SubscriptionTier;
  perBorrowerRate: number;
  activeMonitoredCount: number;
}

export interface Organization {
  id?: string;
  name: string;
  type: OrganizationType;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  settings: OrganizationSettings;
  subscription: OrganizationSubscription;
  stripe?: StripeSubscriptionData;
  onboardingCompleted?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
