import { Timestamp } from "firebase-admin/firestore";

export enum NotificationType {
  SMS = "SMS",
  EMAIL = "EMAIL",
}

export enum NotificationTrigger {
  LAPSE_DETECTED = "LAPSE_DETECTED",
  EXPIRING_SOON = "EXPIRING_SOON",
  REINSTATEMENT_REMINDER = "REINSTATEMENT_REMINDER",
}

export enum NotificationStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  FAILED = "FAILED",
}

export interface Notification {
  id?: string;
  borrowerId: string;
  organizationId: string;
  type: NotificationType;
  trigger: NotificationTrigger;
  status: NotificationStatus;
  sentAt?: Timestamp;
  content: string;
  createdAt: Timestamp;
}
