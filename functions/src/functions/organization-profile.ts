import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireOrg, requireRole } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { AuditAction, AuditEntityType } from "../types/audit";
import { OrganizationType } from "../types/organization";
import { UserRole } from "../types/user";

const DEFAULT_ORG_NAME = "My Organization";

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function getBootstrapOrganizationName(
  organizationName: string | undefined,
  displayName: string,
): string {
  const normalizedOrganizationName = collapseWhitespace(organizationName ?? "");
  if (normalizedOrganizationName) {
    return normalizedOrganizationName;
  }

  const normalizedDisplayName = collapseWhitespace(displayName);
  return normalizedDisplayName
    ? `${normalizedDisplayName}'s Organization`
    : DEFAULT_ORG_NAME;
}

export const getOrganizationProfile = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as { organizationId?: string };

  if (!data.organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }

  requireOrg(user, data.organizationId);

  const orgDoc = await collections.organizations.doc(data.organizationId).get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }

  const org = orgDoc.data()!;
  return {
    name: org.name,
    type: org.type,
  };
});

export const updateOrganizationProfile = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as {
    organizationId?: string;
    name?: string;
    type?: OrganizationType;
  };

  if (!data.organizationId || !data.name) {
    throw new HttpsError("invalid-argument", "organizationId and name are required.");
  }

  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
  requireOrg(user, data.organizationId);

  const orgDoc = await collections.organizations.doc(data.organizationId).get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }

  const previousOrg = orgDoc.data()!;
  const name = collapseWhitespace(data.name);
  if (!name) {
    throw new HttpsError("invalid-argument", "Organization name cannot be empty.");
  }
  if (name.length > 120) {
    throw new HttpsError("invalid-argument", "Organization name must be 120 characters or fewer.");
  }

  const nextType = data.type && Object.values(OrganizationType).includes(data.type)
    ? data.type
    : previousOrg.type;

  await collections.organizations.doc(data.organizationId).update({
    name,
    type: nextType,
    updatedAt: Timestamp.now(),
  });

  await logAudit({
    organizationId: data.organizationId,
    entityType: AuditEntityType.ORGANIZATION,
    entityId: data.organizationId,
    action: AuditAction.SETTINGS_UPDATED,
    performedBy: user.email ?? "unknown",
    previousValue: {
      name: previousOrg.name,
      type: previousOrg.type,
    },
    newValue: {
      name,
      type: nextType,
    },
  });

  return {
    success: true,
    name,
    type: nextType,
  };
});