import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { AuditAction, AuditEntityType } from "../types/audit";

export async function logAudit(params: {
  organizationId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  performedBy: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
}): Promise<void> {
  await collections.auditLog.add({
    organizationId: params.organizationId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    performedBy: params.performedBy,
    previousValue: params.previousValue,
    newValue: params.newValue,
    timestamp: Timestamp.now(),
  });
}
