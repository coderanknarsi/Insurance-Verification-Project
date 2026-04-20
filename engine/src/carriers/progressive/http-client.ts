/**
 * Progressive PROVE Direct HTTP Client
 *
 * Uses Bearer JWT (from OAuth2 login) + api_key header to make direct
 * HTTP requests to the PROVE API, bypassing the browser entirely.
 *
 * Discovered endpoints (from capture script, April 4 2026):
 *   POST   /ProveAPI/v1/vehicles  — VIN search:    { RiskCode: "AU", FullVinNumber }
 *   POST   /ProveAPI/v1/vehicles  — Policy search:  { PolicyNumber, VinLastSixNumbers }
 *   DELETE /ProveAPI/v1/vehicles  — Clear previous search session
 *
 * The search returns full policy data in one call (no separate detail endpoint).
 */
import type {
  ProveSearchRequest,
  ProveSearchResponse,
  ProveApiError,
} from "./api-types.js";
import type { ProveSession } from "./session.js";

const API_BASE = "https://api.progressive.com";
const VEHICLES_ENDPOINT = "/ProveAPI/v1/vehicles";
const API_KEY = "69fc6eb45aae482c82567101c6bc67f5";

function proveHeaders(session: ProveSession): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    Authorization: `Bearer ${session.bearerToken}`,
    api_key: API_KEY,
    "x-pgrclient": "PROVE",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: "https://prove.progressive.com/",
  };
}

/**
 * Clears any previous search session. PROVE requires this before a new search.
 */
async function clearSearch(session: ProveSession): Promise<void> {
  const url = `${API_BASE}${VEHICLES_ENDPOINT}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: proveHeaders(session),
    redirect: "manual",
  });
  // Ignore errors — this is best-effort cleanup
  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError(
      `Session expired during search clear (HTTP ${response.status})`
    );
  }
}

/**
 * Executes a PROVE search (VIN or policy number) and returns the response.
 */
async function executeSearch(
  session: ProveSession,
  body: ProveSearchRequest
): Promise<ProveSearchResponse | null> {
  const url = `${API_BASE}${VEHICLES_ENDPOINT}`;

  const response = await fetch(url, {
    method: "POST",
    headers: proveHeaders(session),
    body: JSON.stringify(body),
    redirect: "manual",
  });

  if (response.status === 302 || response.status === 401 || response.status === 403) {
    throw new SessionExpiredError(
      `Session expired during search (HTTP ${response.status})`
    );
  }

  // 404 = no matching policy
  if (response.status === 404) {
    const errBody = (await response.json().catch(() => null)) as ProveApiError | null;
    const msg = errBody?.displayMessage ?? "No policy found";
    console.log(`[prove-http] Search 404: ${msg}`);
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `PROVE search failed: ${response.status} ${response.statusText} — ${text.substring(0, 200)}`
    );
  }

  return (await response.json()) as ProveSearchResponse;
}

/**
 * Searches by VIN first, then falls back to policy number + last 6 of VIN.
 * Returns full policy data or null if nothing found.
 */
export async function searchPolicy(
  session: ProveSession,
  vin: string,
  policyNumber?: string
): Promise<ProveSearchResponse | null> {
  // Try VIN search first
  const vinResult = await executeSearch(session, {
    RiskCode: "AU",
    FullVinNumber: vin,
  });
  if (vinResult) return vinResult;

  // If we have a policy number, try policy number search (handles new-policy indexing lag)
  if (policyNumber) {
    console.log(`[prove-http] VIN search failed, trying policy number search…`);
    await clearSearch(session);
    const policyResult = await executeSearch(session, {
      PolicyNumber: policyNumber,
      VinLastSixNumbers: vin.slice(-6),
    });
    if (policyResult) return policyResult;
  }

  return null;
}

/** Thrown when the session cookies are no longer valid */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}
