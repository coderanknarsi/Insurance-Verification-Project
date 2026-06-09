/// <reference lib="dom" />
import type { Page } from "playwright-core";
import type {
  AdapterContext,
  CarrierAdapter,
  PolicyInput,
  ScrapeResult,
} from "../types";

/**
 * Progressive PROVE adapter.
 *
 * Unlike the State Farm adapter (which scrapes the DOM), PROVE exposes a clean
 * JSON API at api.progressive.com. The PROVE single-page app authenticates via
 * OAuth2 (PingFederate) and attaches a short-lived Bearer JWT (~5 min TTL) plus
 * a static `api_key` header to every request. The token lives only in the SPA's
 * JS memory — it is NOT in local/sessionStorage — so we capture it passively
 * from the SPA's own outgoing request headers, reloading the tab to mint a fresh
 * one when needed.
 *
 * All API calls are issued from within the page context (`page.evaluate` +
 * fetch) so they inherit the user's authenticated session, cookies and proxy —
 * exactly how the SPA itself talks to the API.
 *
 * Discovered endpoints (capture, June 7 2026):
 *   POST   /ProveAPI/v1/vehicles  — VIN search:    { RiskCode: "AU", FullVinNumber }
 *   POST   /ProveAPI/v1/vehicles  — Policy search: { PolicyNumber, VinLastSixNumbers }
 *   DELETE /ProveAPI/v1/vehicles  — clears the previous search session
 */

const PROVE_HOST = "prove.progressive.com";
const API_BASE = "https://api.progressive.com";
const VEHICLES_ENDPOINT = "/ProveAPI/v1/vehicles";
const API_KEY = "69fc6eb45aae482c82567101c6bc67f5";
const LOGIN_FRAGMENT = "/login";
// When a PROVE session expires the SPA bounces to PingFederate on this host
// (e.g. login.progressive.com/as/authorization.oauth2 …). Treat it as logged-out
// so the sweep login gate blocks and prompts a re-login instead of running and
// failing mid-VIN with an opaque "Failed to fetch".
const AUTH_REDIRECT_HOST = "login.progressive.com";

// Token is good for ~5 min; refresh proactively a little before that.
const TOKEN_MAX_AGE_MS = 4 * 60 * 1000;
const TOKEN_CAPTURE_TIMEOUT_MS = 20_000;

interface CapturedAuth {
  bearer: string;
  capturedAt: number;
}

// Per-page captured auth (the run engine reuses one page per carrier).
const authByPage = new WeakMap<Page, CapturedAuth>();
// Ensures we only install the request listener once per page.
const listenerInstalled = new WeakSet<Page>();

/** Shape returned to the backend Progressive normalizer (raw field). */
type ProgressiveScraped = {
  policyNumber?: string;
  policyStatus?: string;
  effectiveDate?: string;
  expirationDate?: string;
  primaryNamedInsured?: string;
  bipdDescription?: string;
  hasComprehensive?: boolean;
  comprehensiveDeductible?: string;
  hasCollision?: boolean;
  collisionDeductible?: string;
  lienholderName?: string;
  lienholderAddress?: string;
  drivers?: string[];
  vin?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
};

function installAuthListener(page: Page): void {
  if (listenerInstalled.has(page)) return;
  listenerInstalled.add(page);
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith(API_BASE)) return;
    const auth = req.headers()["authorization"];
    if (auth && /^Bearer\s+/i.test(auth)) {
      authByPage.set(page, {
        bearer: auth.replace(/^Bearer\s+/i, "").trim(),
        capturedAt: Date.now(),
      });
    }
  });
}

function freshAuth(page: Page): CapturedAuth | null {
  const a = authByPage.get(page);
  if (!a) return null;
  if (Date.now() - a.capturedAt > TOKEN_MAX_AGE_MS) return null;
  return a;
}

/**
 * Ensures we hold a fresh Bearer token. If none is cached (or it is stale),
 * reload the PROVE app — on startup the SPA fires API calls that carry a fresh
 * token, which our request listener captures.
 */
async function ensureToken(
  page: Page,
  ctx: AdapterContext,
): Promise<string | null> {
  const existing = freshAuth(page);
  if (existing) return existing.bearer;

  ctx.log("No fresh PROVE token cached; reloading portal to capture one");
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    // Let the SPA (and Progressive's Quantum Metric fetch wrapper) finish
    // bootstrapping before we issue our own cross-origin fetch — firing it
    // mid-load is what surfaces as a transient "Failed to fetch".
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => undefined);
  } catch (err) {
    ctx.log("PROVE reload failed", { error: String(err) });
  }

  const deadline = Date.now() + TOKEN_CAPTURE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const a = freshAuth(page);
    if (a) return a.bearer;
    await page.waitForTimeout(400);
  }
  return null;
}

interface ProveCallResult {
  status: number;
  body: unknown;
}

/**
 * Issues a PROVE API call from within the page context so it inherits the
 * authenticated browser session (cookies, proxy, TLS fingerprint).
 */
async function proveCall(
  page: Page,
  bearer: string,
  method: "POST" | "DELETE",
  body: Record<string, unknown> | null,
): Promise<ProveCallResult> {
  return page.evaluate(
    async ({ url, method, headers, body }) => {
      // A cross-origin fetch from the PROVE SPA can transiently reject with
      // "Failed to fetch" (e.g. right after a reload, or via Progressive's
      // Quantum Metric fetch wrapper). Catch it here and surface status 0 so
      // the caller can retry instead of throwing out of the whole verify.
      try {
        const res = await fetch(url, {
          method,
          headers,
          credentials: "include",
          body: body ? JSON.stringify(body) : undefined,
        });
        let parsed: unknown = null;
        const text = await res.text().catch(() => "");
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        return { status: res.status, body: parsed };
      } catch (e) {
        return { status: 0, body: e instanceof Error ? e.message : String(e) };
      }
    },
    {
      url: `${API_BASE}${VEHICLES_ENDPOINT}`,
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Authorization: `Bearer ${bearer}`,
        api_key: API_KEY,
        "x-pgrclient": "PROVE",
      } as Record<string, string>,
      body,
    },
  );
}

/** Maps a successful PROVE search response into the backend scrape shape. */
function mapProveResponse(
  resp: Record<string, unknown>,
): ProgressiveScraped | null {
  const policies = resp.policies as Record<string, unknown> | undefined;
  if (!policies) return null;

  const vehicle = policies.vehicles as Record<string, unknown> | undefined;
  const coverages =
    (policies.coverages as Array<Record<string, unknown>>) ?? [];
  const termDetails =
    (policies.termDetails as Array<Record<string, unknown>>) ?? [];
  const drivers = (policies.drivers as Array<Record<string, unknown>>) ?? [];
  const pni = policies.primaryNamedInsured as
    | Record<string, unknown>
    | undefined;

  const findCov = (name: string) =>
    coverages.find((c) => String(c.name).toUpperCase() === name.toUpperCase());
  const bipd = findCov("BIPD");
  const comp = findCov("COMP");
  const coll = findCov("COLL");

  const term = termDetails[0];

  // Lienholder lives on the vehicle.
  const lienholders =
    (vehicle?.vehicleLienholders as Array<Record<string, unknown>>) ?? [];
  const lh = lienholders[0];
  const lienholderAddress = lh
    ? [
        lh.lienholderAddressLineOne,
        lh.lienholderAddressLineTwo,
        lh.lienholderAddressCity,
        lh.lienholderAddressState,
        lh.lienholderAddressZip,
      ]
        .map((s) => (s ? String(s).trim() : ""))
        .filter(Boolean)
        .join(", ")
    : undefined;

  return {
    policyNumber: policies.number ? String(policies.number) : undefined,
    policyStatus: policies.status ? String(policies.status) : undefined,
    effectiveDate: term?.termDetailEffectiveDate
      ? String(term.termDetailEffectiveDate)
      : policies.effectiveDate
        ? String(policies.effectiveDate)
        : undefined,
    expirationDate: term?.termDetailExpirationDate
      ? String(term.termDetailExpirationDate)
      : undefined,
    primaryNamedInsured: pni?.name ? String(pni.name) : undefined,
    bipdDescription: bipd?.description ? String(bipd.description) : undefined,
    hasComprehensive: !!comp,
    comprehensiveDeductible: comp?.description
      ? String(comp.description)
      : undefined,
    hasCollision: !!coll,
    collisionDeductible: coll?.description
      ? String(coll.description)
      : undefined,
    lienholderName: lh?.lienholderName ? String(lh.lienholderName) : undefined,
    lienholderAddress,
    drivers: drivers.map((d) => (d.name ? String(d.name) : "")).filter(Boolean),
    vin: vehicle?.vin ? String(vehicle.vin) : undefined,
    vehicleYear: vehicle?.modelYear ? String(vehicle.modelYear) : undefined,
    vehicleMake: vehicle?.make ? String(vehicle.make) : undefined,
    vehicleModel: vehicle?.model ? String(vehicle.model) : undefined,
  };
}

type SearchOutcome =
  | { kind: "found"; data: ProgressiveScraped }
  | { kind: "not-found" }
  | { kind: "unauthorized" }
  | { kind: "network-error"; reason: string }
  | { kind: "error"; reason: string };

/** Runs one PROVE search (VIN or policy number). */
async function search(
  page: Page,
  bearer: string,
  body: Record<string, unknown>,
): Promise<SearchOutcome> {
  const res = await proveCall(page, bearer, "POST", body);
  // status 0 = the in-page fetch threw (e.g. "Failed to fetch") rather than
  // returning an HTTP response — retryable, not a real auth/data failure.
  if (res.status === 0) {
    return {
      kind: "network-error",
      reason:
        typeof res.body === "string" && res.body ? res.body : "Failed to fetch",
    };
  }
  if (res.status === 401 || res.status === 403 || res.status === 302) {
    return { kind: "unauthorized" };
  }
  if (res.status === 404) {
    return { kind: "not-found" };
  }
  if (res.status !== 200) {
    const msg =
      (res.body as Record<string, unknown> | null)?.displayMessage ??
      `HTTP ${res.status}`;
    return { kind: "error", reason: String(msg) };
  }
  const mapped = mapProveResponse(res.body as Record<string, unknown>);
  if (!mapped) return { kind: "not-found" };
  return { kind: "found", data: mapped };
}

export const progressiveAdapter: CarrierAdapter = {
  id: "progressive",
  name: "Progressive (PROVE)",
  ready: true,
  loginUrl: "https://prove.progressive.com/login",
  searchUrl: "https://prove.progressive.com/",
  // Reuse the PROVE tab the operator already has logged in.
  searchPageFragment: PROVE_HOST,

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (url.includes(AUTH_REDIRECT_HOST)) return false;
      if (!url.includes(PROVE_HOST)) return false;
      return !url.includes(LOGIN_FRAGMENT);
    } catch {
      return false;
    }
  },

  async verifyVin(
    page: Page,
    policy: PolicyInput,
    ctx: AdapterContext,
  ): Promise<ScrapeResult> {
    try {
      const url = page.url();
      if (
        url.includes(AUTH_REDIRECT_HOST) ||
        !url.includes(PROVE_HOST) ||
        url.includes(LOGIN_FRAGMENT)
      ) {
        ctx.log(
          "Not on the Progressive PROVE portal. Log into prove.progressive.com " +
            "and reach the Find a Policy page before starting the sweep.",
        );
        return { status: "error", reason: "Not logged into Progressive PROVE" };
      }

      installAuthListener(page);
      await ctx.screenshot("01-prove");

      let bearer = await ensureToken(page, ctx);
      if (!bearer) {
        return {
          status: "error",
          reason:
            "Could not capture a PROVE auth token. Make sure you are logged in.",
        };
      }

      // Clear any previous search session (PROVE requires this), then search.
      await proveCall(page, bearer, "DELETE", null).catch(() => undefined);

      ctx.log("PROVE VIN search", { vin: policy.vin });
      let result = await search(page, bearer, {
        RiskCode: "AU",
        FullVinNumber: policy.vin,
      });

      // The token can expire mid-run (401), or the cross-origin fetch can
      // transiently reject ("Failed to fetch") right after the portal reload.
      // Either way, reload the SPA to re-warm the page + mint a fresh token,
      // then retry the search once.
      if (result.kind === "unauthorized" || result.kind === "network-error") {
        ctx.log(
          result.kind === "unauthorized"
            ? "PROVE session unauthorized; refreshing token and retrying"
            : "PROVE request failed to fetch; reloading portal and retrying",
          result.kind === "network-error" ? { reason: result.reason } : undefined,
        );
        authByPage.delete(page);
        bearer = await ensureToken(page, ctx);
        if (!bearer) {
          return { status: "error", reason: "PROVE token refresh failed" };
        }
        await proveCall(page, bearer, "DELETE", null).catch(() => undefined);
        result = await search(page, bearer, {
          RiskCode: "AU",
          FullVinNumber: policy.vin,
        });
      }

      // VIN search can miss very new policies (indexing lag) — fall back to
      // policy-number + last 6 of VIN when we have a policy number.
      if (result.kind === "not-found" && policy.policyNumber) {
        ctx.log("VIN search not found; trying policy-number search", {
          policyNumber: policy.policyNumber,
        });
        await proveCall(page, bearer, "DELETE", null).catch(() => undefined);
        result = await search(page, bearer, {
          PolicyNumber: policy.policyNumber,
          VinLastSixNumbers: policy.vin.slice(-6),
        });
      }

      await ctx.screenshot("02-after-search");

      if (result.kind === "found") {
        ctx.log("scraped policy", result.data);
        return {
          status: "found",
          data: {
            policyNumber: result.data.policyNumber,
            coverages: result.data as unknown as Record<
              string,
              string | number | boolean
            >,
            raw: result.data as unknown as Record<string, unknown>,
          },
        };
      }
      if (result.kind === "not-found") {
        return { status: "not-found" };
      }
      if (result.kind === "unauthorized") {
        return { status: "error", reason: "PROVE session unauthorized" };
      }
      return { status: "error", reason: result.reason };
    } catch (err) {
      ctx.log("verifyVin error", { error: String(err) });
      try {
        await ctx.screenshot("99-error");
      } catch {
        // ignore
      }
      return {
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
