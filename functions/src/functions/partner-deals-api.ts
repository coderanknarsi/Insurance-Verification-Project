import { onRequest, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { ApiKeyError, requireApiKey, type ApiKeyContext } from "../middleware/api-key";
import { rateLimit } from "../middleware/rate-limit";
import {
  ingestDeal,
  validateDealIngestInput,
  type DealIngestInput,
} from "../services/deal-ingest";

/**
 * Partner REST API — lets external systems (DMS like Frazer, CRMs, in-house
 * dealer tools) push funded deals into AutoLien and poll verification status.
 *
 *   POST /v1/deals            create/update borrower + vehicle + policy
 *   GET  /v1/deals/{policyId} current verification status
 *
 * Auth: per-organization API key (Authorization: Bearer alt_live_…).
 * Tenant isolation: organizationId always comes from the key, never the body.
 * Idempotency: optional Idempotency-Key header; replays return the original
 * response. Borrowers also dedupe by loanNumber, vehicles by VIN.
 */

interface DealsApiBody {
  borrower?: DealIngestInput["borrower"];
  vehicle?: DealIngestInput["vehicle"];
  insurance?: DealIngestInput["insurance"];
}

function sendJson(
  res: { status: (n: number) => { json: (b: unknown) => void } },
  status: number,
  body: unknown,
): void {
  res.status(status).json(body);
}

function errorBody(code: string, message: string): unknown {
  return { error: { code, message } };
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Max accepted request body, in bytes. A single deal is a few KB; 256 KB is a
 * generous ceiling that still rejects abusive/oversized payloads before they
 * reach ingestion.
 */
export const MAX_BODY_BYTES = 256 * 1024;

/** Throws HttpsError("invalid-argument") when a body exceeds MAX_BODY_BYTES. */
export function assertPayloadWithinLimit(len: number): void {
  if (len > MAX_BODY_BYTES) {
    throw new HttpsError("invalid-argument", "Request payload too large.");
  }
}

// Rate limit per API key: 120 requests/minute is comfortable for a DMS
// pushing deals in bursts while still throttling runaway clients.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_RETRY_AFTER_S = 60;

async function handlePostDeal(
  ctx: ApiKeyContext,
  body: DealsApiBody,
  idempotencyKey: string | undefined,
): Promise<{ status: number; body: unknown }> {
  const input: DealIngestInput = {
    organizationId: ctx.organizationId,
    borrower: body.borrower as DealIngestInput["borrower"],
    vehicle: body.vehicle as DealIngestInput["vehicle"],
    insurance: body.insurance,
  };

  try {
    validateDealIngestInput(input);
  } catch (err) {
    const message = err instanceof HttpsError ? err.message : String(err);
    return { status: 422, body: errorBody("invalid_request", message) };
  }

  // Idempotency replay: same key + same Idempotency-Key returns the original
  // response without re-running ingestion.
  const idemRef = idempotencyKey
    ? db.collection("apiIdempotency").doc(`${ctx.keyId}_${idempotencyKey}`)
    : null;
  if (idemRef) {
    const existing = await idemRef.get();
    if (existing.exists) {
      const stored = existing.data()!;
      const age = Date.now() - (stored.createdAt?.toDate?.()?.getTime?.() ?? 0);
      if (age < IDEMPOTENCY_TTL_MS) {
        return { status: 200, body: { ...(stored.response as object), idempotentReplay: true } };
      }
    }
  }

  const result = await ingestDeal(input, `api:${ctx.keyId}`);

  const response = {
    policyId: result.policyId,
    borrowerId: result.borrowerId,
    vehicleId: result.vehicleId,
    isNewBorrower: result.isNewBorrower,
    intakeRequested: !!result.intakeNotify,
  };

  if (idemRef) {
    await idemRef
      .set({ response, createdAt: Timestamp.now() })
      .catch((err) =>
        logger.warn("[partner-api] idempotency store failed", { error: String(err) }),
      );
  }

  return { status: 201, body: response };
}

async function handleGetDeal(
  ctx: ApiKeyContext,
  policyId: string,
): Promise<{ status: number; body: unknown }> {
  const snap = await collections.policies.doc(policyId).get();
  if (!snap.exists) {
    return { status: 404, body: errorBody("not_found", "Deal not found.") };
  }
  const policy = snap.data()! as unknown as Record<string, unknown>;
  if (policy.organizationId !== ctx.organizationId) {
    // Same response as not-found: don't leak other tenants' policy IDs.
    return { status: 404, body: errorBody("not_found", "Deal not found.") };
  }

  let loanNumber: string | null = null;
  if (policy.borrowerId) {
    const borrowerSnap = await collections.borrowers
      .doc(policy.borrowerId as string)
      .get();
    loanNumber = (borrowerSnap.data()?.loanNumber as string | undefined) ?? null;
  }

  const ts = (v: unknown): string | null =>
    (v as Timestamp | undefined)?.toDate?.()?.toISOString?.() ?? null;

  return {
    status: 200,
    body: {
      policyId: snap.id,
      loanNumber,
      status: policy.status ?? null,
      dashboardStatus: policy.dashboardStatus ?? null,
      complianceIssues: policy.complianceIssues ?? [],
      isLienholderListed: policy.isLienholderListed ?? null,
      insuranceProvider: policy.insuranceProvider ?? null,
      policyNumber: policy.policyNumber ?? null,
      lastVerifiedAt: ts(policy.lastVerifiedAt),
      lastVerificationError: policy.lastVerificationError ?? null,
    },
  };
}

export const partnerDealsApi = onRequest(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (req, res) => {
    try {
      const path = (req.path || "/").replace(/\/+$/, "") || "/";
      const dealMatch = path.match(/^\/v1\/deals(?:\/([^/]+))?$/);
      if (!dealMatch) {
        sendJson(res, 404, errorBody("not_found", "Unknown endpoint."));
        return;
      }

      const ctx = await requireApiKey(req);
      const policyId = dealMatch[1];

      // Per-key rate limit. Best-effort (in-memory per instance); throws
      // HttpsError("resource-exhausted") when exceeded.
      try {
        rateLimit(`partnerApi:${ctx.keyId}`, {
          windowMs: RATE_LIMIT_WINDOW_MS,
          max: RATE_LIMIT_MAX,
        });
      } catch (rlErr) {
        if (rlErr instanceof HttpsError && rlErr.code === "resource-exhausted") {
          res.set("Retry-After", String(RATE_LIMIT_RETRY_AFTER_S));
          sendJson(res, 429, errorBody("rate_limited", rlErr.message));
          return;
        }
        throw rlErr;
      }

      // Reject oversized bodies before doing any work.
      const rawLen = req.rawBody
        ? req.rawBody.length
        : Buffer.byteLength(JSON.stringify(req.body ?? {}));
      try {
        assertPayloadWithinLimit(rawLen);
      } catch (sizeErr) {
        const message =
          sizeErr instanceof HttpsError ? sizeErr.message : "Request payload too large.";
        sendJson(res, 413, errorBody("invalid_request", message));
        return;
      }

      if (req.method === "POST" && !policyId) {
        const out = await handlePostDeal(
          ctx,
          (req.body ?? {}) as DealsApiBody,
          req.get("idempotency-key") ?? undefined,
        );
        sendJson(res, out.status, out.body);
        return;
      }

      if (req.method === "GET" && policyId) {
        const out = await handleGetDeal(ctx, policyId);
        sendJson(res, out.status, out.body);
        return;
      }

      sendJson(res, 405, errorBody("method_not_allowed", "Use POST /v1/deals or GET /v1/deals/{policyId}."));
    } catch (err) {
      if (err instanceof ApiKeyError) {
        sendJson(res, err.statusCode, errorBody("unauthorized", err.message));
        return;
      }
      if (err instanceof HttpsError) {
        sendJson(res, 422, errorBody("invalid_request", err.message));
        return;
      }
      logger.error("[partner-api] Unhandled error", { error: String(err) });
      sendJson(res, 500, errorBody("internal", "Internal error."));
    }
  },
);
