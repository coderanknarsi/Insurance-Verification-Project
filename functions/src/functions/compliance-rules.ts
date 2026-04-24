import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { AuditAction, AuditEntityType } from "../types/audit";
import { UserRole } from "../types/user";
import type { ComplianceRules } from "../types/organization";

const DEFAULT_TIMEZONE = "America/Chicago";

const DEFAULT_RULES: ComplianceRules = {
  requireLienholder: true,
  requireComprehensive: true,
  requireCollision: true,
  expirationWarningDays: 15,
  lapseGracePeriodDays: 5,
  autoSendReminder: false,
  reminderDaysBeforeExpiry: 10,
  timezone: DEFAULT_TIMEZONE,
};

/**
 * Validates that the given string is a supported IANA timezone in this runtime.
 * Returns the validated timezone or throws an HttpsError.
 */
function validateTimezone(tz: string): string {
  try {
    // This throws `RangeError` for invalid timezones.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    throw new HttpsError(
      "invalid-argument",
      `Invalid timezone: "${tz}". Use an IANA timezone like "America/Chicago".`
    );
  }
}

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
  const stored = org?.settings?.complianceRules;
  // Backfill legacy records that don't yet have a timezone.
  return {
    ...DEFAULT_RULES,
    ...(stored ?? {}),
    timezone: stored?.timezone ?? DEFAULT_TIMEZONE,
  };
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
    timezone: data.rules.timezone
      ? validateTimezone(data.rules.timezone)
      : DEFAULT_TIMEZONE,
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
