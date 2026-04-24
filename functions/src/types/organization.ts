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
}

export interface OrganizationSettings {
  notificationPreference: NotificationPreference;
  lapseGracePeriodDays: number;
  expirationWarningDays: number;
  complianceRules?: ComplianceRules;
  lienholderName?: string;
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
