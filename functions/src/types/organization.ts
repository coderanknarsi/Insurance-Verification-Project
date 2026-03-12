import { Timestamp } from "firebase-admin/firestore";

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

export interface OrganizationSettings {
  notificationPreference: NotificationPreference;
  lapseGracePeriodDays: number;
  expirationWarningDays: number;
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
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
