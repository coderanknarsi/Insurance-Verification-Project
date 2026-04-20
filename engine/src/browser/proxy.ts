import { randomBytes } from "crypto";

const SMARTPROXY_USER = process.env.SMARTPROXY_USER ?? "";
const SMARTPROXY_PASS = process.env.SMARTPROXY_PASS ?? "";
const SMARTPROXY_HOST = "gate.smartproxy.com";
const SMARTPROXY_PORT = 10001;

/** Returns a proxy URL with a sticky session ID (same IP for ~10 min) */
export function getProxyUrl(): string {
  const sessionId = randomBytes(8).toString("hex");
  const user = `${SMARTPROXY_USER}-session-${sessionId}`;
  return `http://${user}:${SMARTPROXY_PASS}@${SMARTPROXY_HOST}:${SMARTPROXY_PORT}`;
}

export function isProxyConfigured(): boolean {
  return SMARTPROXY_USER.length > 0 && SMARTPROXY_PASS.length > 0;
}
