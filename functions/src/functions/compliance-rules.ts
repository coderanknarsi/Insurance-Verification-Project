import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { AuditAction, AuditEntityType } from "../types/audit";
import { UserRole } from "../types/user";
import type { ComplianceRules } from "../types/organization";

const DEFAULT_RULES: ComplianceRules = {
  requireLienholder: true,
  requireComprehensive: true,
  requireCollision: true,
  expirationWarningDays: 15,
  lapseGracePeriodDays: 5,
  autoSendReminder: false,
  reminderDaysBeforeExpiry: 10,
};

export const getComplianceRules = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as { organizationId: string };

  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  requireOrg(user, data.organizationId);

  const orgDoc = await collections.organizations.doc(data.organizationId).get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }

  const org = orgDoc.data();
  return org?.settings?.complianceRules ?? DEFAULT_RULES;
});

export const updateComplianceRules = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as {
    organizationId: string;
    rules: ComplianceRules;
  };

  if (!data.organizationId || !data.rules) {
    throw new HttpsError(
      "invalid-argument",
      "organizationId and rules are required."
    );
  }

  requireRole(user, UserRole.ADMIN);
  requireOrg(user, data.organizationId);

  const orgDoc = await collections.organizations.doc(data.organizationId).get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }

  const previousRules =
    orgDoc.data()?.settings?.complianceRules ?? DEFAULT_RULES;

  // Validate rules
  const rules: ComplianceRules = {
    requireLienholder: Boolean(data.rules.requireLienholder),
    requireComprehensive: Boolean(data.rules.requireComprehensive),
    requireCollision: Boolean(data.rules.requireCollision),
    ...(data.rules.maxCompDeductible != null
      ? { maxCompDeductible: Number(data.rules.maxCompDeductible) }
      : {}),
    ...(data.rules.maxCollisionDeductible != null
      ? { maxCollisionDeductible: Number(data.rules.maxCollisionDeductible) }
      : {}),
    expirationWarningDays: Number(data.rules.expirationWarningDays) || 15,
    lapseGracePeriodDays: Number(data.rules.lapseGracePeriodDays) || 5,
    autoSendReminder: Boolean(data.rules.autoSendReminder),
    reminderDaysBeforeExpiry: Number(data.rules.reminderDaysBeforeExpiry) || 10,
  };

  await collections.organizations.doc(data.organizationId).update({
    "settings.complianceRules": rules,
    updatedAt: Timestamp.now(),
  });

  await logAudit({
    organizationId: data.organizationId,
    entityType: AuditEntityType.ORGANIZATION,
    entityId: data.organizationId,
    action: AuditAction.SETTINGS_UPDATED,
    performedBy: user.email ?? "unknown",
    previousValue: previousRules as unknown as Record<string, unknown>,
    newValue: rules as unknown as Record<string, unknown>,
  });

  return { success: true };
});
