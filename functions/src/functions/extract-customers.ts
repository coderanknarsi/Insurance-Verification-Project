import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { UserRole } from "../types/user";
import { extractCustomersFromDocument } from "../services/customer-extract";
import type { ExtractedCustomerRow } from "../services/customer-extract";

interface ExtractInput {
  organizationId: string;
  /** Base64-encoded file (no `data:` prefix). */
  fileBase64: string;
  /** MIME type — application/pdf, image/png, image/jpeg, image/webp. */
  mimeType: string;
  /** File name for logging only. */
  fileName?: string;
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB inline limit for Gemini.

export const extractCustomersFromFile = onCall(
  { timeoutSeconds: 540, memory: "1GiB" },
  async (request): Promise<{ rows: ExtractedCustomerRow[] }> => {
    const { user } = await requireAuth(request);
    const data = request.data as ExtractInput;

    if (!data.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required.");
    }
    if (!data.fileBase64 || typeof data.fileBase64 !== "string") {
      throw new HttpsError("invalid-argument", "fileBase64 is required.");
    }
    if (!data.mimeType || !ALLOWED_MIME_TYPES.has(data.mimeType)) {
      throw new HttpsError(
        "invalid-argument",
        `Unsupported file type: ${data.mimeType}. Allowed: PDF, PNG, JPEG, WEBP, HEIC.`,
      );
    }

    requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    requireOrg(user, data.organizationId);

    // Throttle costly Gemini extractions per org/user.
    rateLimit(`extractCustomers:${data.organizationId}`, { windowMs: 60_000, max: 10 });

    // Approx decoded size — base64 is ~4/3 of binary.
    const approxBytes = Math.floor((data.fileBase64.length * 3) / 4);
    if (approxBytes > MAX_FILE_BYTES) {
      throw new HttpsError(
        "invalid-argument",
        `File too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.`,
      );
    }

    logger.info("[extract-customers] starting extraction", {
      orgId: data.organizationId,
      fileName: data.fileName,
      mimeType: data.mimeType,
      approxBytes,
    });

    try {
      const rows = await extractCustomersFromDocument(data.fileBase64, data.mimeType);
      logger.info("[extract-customers] done", {
        orgId: data.organizationId,
        rowCount: rows.length,
      });
      return { rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown extraction error";
      logger.error("[extract-customers] extraction failed", { error: message });
      throw new HttpsError("internal", message);
    }
  },
);
