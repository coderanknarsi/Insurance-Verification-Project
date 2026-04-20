import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { AuditAction, AuditEntityType, AuditLogEntry } from "../types/audit";

export async function logAudit(params: {
  organizationId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  performedBy: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
}): Promise<void> {
  const doc: Omit<AuditLogEntry, "id"> = {
    organizationId: params.organizationId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    performedBy: params.performedBy,
    timestamp: Timestamp.now(),
    ...(params.previousValue !== undefined && { previousValue: params.previousValue }),
    ...(params.newValue !== undefined && { newValue: params.newValue }),
  };
  await collections.auditLog.add(doc);
}
