/**
 * Progressive PROVE Session Manager
 *
 * Handles the AI-driven login, extracts session cookies,
 * and provides a lightweight session object for direct HTTP calls.
 */
import { launchBrowser, type BrowserSession } from "../../browser/pool.js";
import { agentLoop } from "../../agent/loop.js";
import type { CarrierCredentialPayload } from "../../types/credentials.js";
import { LOGIN_CONTEXT } from "./prompts.js";

const PROVE_URL = "https://prove.progressive.com";
/** Default session max age: 25 minutes (PROVE sessions typically last ~30min) */
const DEFAULT_MAX_AGE_MS = 25 * 60 * 1000;

export interface ProveSession {
  /** Bearer JWT from the OAuth2 token exchange */
  bearerToken: string;
  /** Cookie name→value map for progressive.com */
  cookies: Record<string, string>;
  /** Extra headers needed for API calls (Referer, CSRF, etc.) */
  headers: Record<string, string>;
  /** When this session was created */
  createdAt: Date;
  /** Base URL for API calls */
  baseUrl: string;
}

/**
 * Logs into PROVE using the AI agent, extracts session cookies,
 * closes the browser, and returns a lightweight session object
 * that can be used for direct HTTP calls.
 */
export async function createProveSession(
  credentials: CarrierCredentialPayload
): Promise<ProveSession> {
  let session: BrowserSession | undefined;

  try {
    session = await launchBrowser();
    console.log("[prove-session] Browser launched, navigating to portal...");

    // Intercept the OAuth2 token response to capture the Bearer JWT.
    // PingFederate returns it at login.progressive.com/as/token.oauth2
    let bearerToken: string | null = null;
    session.page.on("response", async (res) => {
      if (res.url().includes("/as/token.oauth2") && res.status() === 200) {
        try {
          const body = await res.json();
          if (body?.access_token) {
            bearerToken = body.access_token;
            console.log("[prove-session] Captured Bearer token from OAuth2 exchange");
          }
        } catch { /* ignore parse errors */ }
      }
    });

    await session.page.goto(PROVE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Run AI login
    const loginTask = {
      goal: `Log into the Progressive PROVE portal. Enter credentials, accept the user agreement, complete 2-step email verification, and reach the "Find a Policy" search page.`,
      context:
        LOGIN_CONTEXT +
        `\n\nUsername: ${credentials.username}\nPassword: ${credentials.password}`,
    };

    const loginResult = await agentLoop(session.page, loginTask);
    if (!loginResult.success) {
      throw new Error(`PROVE login failed: ${loginResult.error}`);
    }

    console.log("[prove-session] Login successful, extracting cookies...");

    // Extract cookies for progressive.com domains
    const rawCookies = await session.getCookies();
    const cookies: Record<string, string> = {};
    for (const c of rawCookies) {
      if (c.domain.includes("progressive.com")) {
        cookies[c.name] = c.value;
      }
    }

    // Build headers that mimic a real browser session
    const headers: Record<string, string> = {
      Referer: session.page.url(),
      Origin: "https://prove.progressive.com",
    };

    // Try to grab a CSRF/anti-forgery token from the page
    const csrfToken = await session.page
      .evaluate(() => {
        const meta = document.querySelector(
          'meta[name="csrf-token"], meta[name="_csrf"], meta[name="__RequestVerificationToken"]'
        );
        if (meta) return meta.getAttribute("content");
        // Also check hidden input forms
        const input = document.querySelector(
          'input[name="__RequestVerificationToken"], input[name="_csrf"]'
        ) as HTMLInputElement | null;
        return input?.value ?? null;
      })
      .catch(() => null);

    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
      headers["__RequestVerificationToken"] = csrfToken;
      console.log("[prove-session] Found CSRF token");
    }

    console.log(
      `[prove-session] Extracted ${Object.keys(cookies).length} cookies`
    );

    if (!bearerToken) {
      throw new Error("PROVE login succeeded but Bearer token was not captured from OAuth2 exchange");
    }

    return {
      bearerToken,
      cookies,
      headers,
      createdAt: new Date(),
      baseUrl: PROVE_URL,
    };
  } finally {
    await session?.close();
    console.log("[prove-session] Browser closed");
  }
}

/** Convert cookies Record to a Cookie header string */
export function cookieString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** Check if a session is likely still valid based on age */
export function isSessionFresh(
  session: ProveSession,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): boolean {
  return Date.now() - session.createdAt.getTime() < maxAgeMs;
}
