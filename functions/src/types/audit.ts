import { Timestamp } from "firebase-admin/firestore";

export enum AuditAction {
  CREATED = "CREATED",
  UPDATED = "UPDATED",
  DELETED = "DELETED",
  STATUS_CHANGED = "STATUS_CHANGED",
  VERIFICATION_REQUESTED = "VERIFICATION_REQUESTED",
  VERIFICATION_COMPLETED = "VERIFICATION_COMPLETED",
}

export enum AuditEntityType {
  ORGANIZATION = "ORGANIZATION",
  USER = "USER",
  BORROWER = "BORROWER",
  VEHICLE = "VEHICLE",
  POLICY = "POLICY",
}

export interface AuditLogEntry {
  id?: string;
  organizationId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  performedBy: string;
  timestamp: Timestamp;
}
