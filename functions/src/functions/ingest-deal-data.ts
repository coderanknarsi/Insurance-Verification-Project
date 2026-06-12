import { onCall } from "firebase-functions/v2/https";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { UserRole } from "../types/user";
import {
  ingestDeal,
  validateDealIngestInput,
  type DealIngestInput,
} from "../services/deal-ingest";

/**
 * Dashboard-facing deal ingestion. Validates the signed-in user's role and
 * org membership, then delegates to the shared `ingestDeal` service (also
 * used by the partner REST API in partner-deals-api.ts).
 */
export const ingestDealData = onCall(async (request) => {
  const { uid, user } = await requireAuth(request);
  const data = request.data as DealIngestInput;

  validateDealIngestInput(data);
  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
  requireOrg(user, data.organizationId);

  return ingestDeal(data, uid);
});
