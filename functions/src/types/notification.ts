import { Timestamp } from "firebase-admin/firestore";

export enum NotificationType {
  SMS = "SMS",
  EMAIL = "EMAIL",
  PORTAL = "PORTAL",
}

export enum NotificationTrigger {
  LAPSE_DETECTED = "LAPSE_DETECTED",
  EXPIRING_SOON = "EXPIRING_SOON",
  REINSTATEMENT_REMINDER = "REINSTATEMENT_REMINDER",
  INTAKE_REQUESTED = "INTAKE_REQUESTED",
  DEALER_SUBMITTED = "DEALER_SUBMITTED",
  INTAKE_COMPLETED = "INTAKE_COMPLETED",
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
