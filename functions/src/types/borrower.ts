import { Timestamp } from "firebase-admin/firestore";

export enum SmsConsentStatus {
  OPTED_IN = "OPTED_IN",
  OPTED_OUT = "OPTED_OUT",
  NOT_SET = "NOT_SET",
}

export interface Borrower {
  id?: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  loanNumber?: string;
  contactIncomplete?: boolean;
  smsConsentStatus?: SmsConsentStatus;
  smsOptInTimestamp?: Timestamp;
  smsOptOutTimestamp?: Timestamp;
  /** Borrower replied HELP to an intake message; staff should follow up. */
  needsHelp?: boolean;
  needsHelpAt?: Timestamp;
  needsHelpResolvedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
