/**
 * TEMP capture script — attaches to the Operator's managed Chrome (CDP 9222)
 * and logs Progressive PROVE network traffic + token storage location so we
 * can build the operator adapter from the live API shape.
 *
 * READ-ONLY: it never clicks or types. It only listens and reads storage.
 * Resilient: waits for Chrome, auto-reconnects on disconnect.
 *
 * Run:  node capture-prove.js   (leave it running)
 * Then: in the Operator's Chrome, log into Progressive PROVE and search a policy.
 * Output: capture-prove-output.json (tokens redacted to last 6 chars).
 * Stop:  Ctrl+C when the search result has loaded.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const CDP = "http://127.0.0.1:9222";
const OUT = path.join(__dirname, "capture-prove-output.json");
const captures = {
  startedAt: new Date().toISOString(),
  token: null,
  storageTokenKeys: [],
  calls: [],
};

const save = () => fs.writeFileSync(OUT, JSON.stringify(captures, null, 2));
const redact = (t) => (t && typeof t === "string" ? `…${t.slice(-6)} (len=${t.length})` : t);
const looksLikeJwt = (v) => typeof v === "string" && /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(v);
const safeJson = (s) => { try { return JSON.parse(s); } catch { return s; } };

const attachedPages = new WeakSet();

async function dumpStorage(page) {
  const url = page.url();
  if (!url.includes("progressive.com")) return;
  try {
    const dump = await page.evaluate(() => {
      const out = { local: {}, session: {} };
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.local[k] = localStorage.getItem(k); } } catch (e) {}
      try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); out.session[k] = sessionStorage.getItem(k); } } catch (e) {}
      return out;
    });
    for (const scope of ["local", "session"]) {
      for (const [k, v] of Object.entries(dump[scope] || {})) {
        let found = null;
        if (looksLikeJwt(v)) found = v;
        else {
          const parsed = safeJson(v);
          if (parsed && typeof parsed === "object") {
            for (const [, pv] of Object.entries(parsed)) {
              if (looksLikeJwt(pv)) { found = pv; break; }
              if (typeof pv === "object" && pv) {
                for (const [, pv2] of Object.entries(pv)) if (looksLikeJwt(pv2)) { found = pv2; break; }
              }
            }
          }
        }
        if (found) {
          if (!captures.storageTokenKeys.some((r) => r.scope === scope && r.storageKey === k)) {
            captures.storageTokenKeys.push({ scope, storageKey: k, urlSeen: url, jwt: redact(found) });
            console.log(`[capture] JWT found in ${scope}Storage["${k}"] (${redact(found)})`);
            save();
          }
        }
      }
    }
  } catch (e) { /* page may be navigating */ }
}

function attachToPage(page) {
  if (attachedPages.has(page)) return;
  attachedPages.add(page);
  page.on("response", async (res) => {
    const url = res.url();
    try {
      if (url.includes("/as/token.oauth2") && res.status() === 200) {
        const body = await res.json().catch(() => null);
        if (body && body.access_token) {
          captures.token = { capturedAt: new Date().toISOString(), redacted: redact(body.access_token), tokenType: body.token_type, expiresIn: body.expires_in };
          console.log(`[capture] Bearer token from OAuth2 (${redact(body.access_token)})`);
          save();
        }
      }
      if (url.includes("api.progressive.com")) {
        const req = res.request();
        const h = await req.allHeaders().catch(() => ({}));
        let reqBody = null; try { reqBody = req.postData(); } catch (e) {}
        const ct = res.headers()["content-type"] || "";
        const resBody = ct.includes("json") ? await res.json().catch(() => null) : (await res.text().catch(() => "")).slice(0, 3000);
        captures.calls.push({
          ts: new Date().toISOString(), method: req.method(), url, status: res.status(),
          reqHeaders: {
            api_key: h["api_key"], "x-pgrclient": h["x-pgrclient"],
            authorization: h["authorization"] ? "Bearer " + redact(h["authorization"].replace(/^Bearer\s+/i, "")) : undefined,
            referer: h["referer"], origin: h["origin"], "content-type": h["content-type"],
          },
          reqBody: reqBody ? safeJson(reqBody) : null,
          resBody,
        });
        console.log(`[capture] ${req.method()} ${url} → ${res.status()}`);
        save();
      }
    } catch (e) { console.log(`[capture] listener error: ${e.message}`); }
  });
}

async function run() {
  console.log("[capture] Waiting for managed Chrome on 9222…");
  let browser = null;
  while (!browser) {
    try { browser = await chromium.connectOverCDP(CDP); }
    catch (e) { await new Promise((r) => setTimeout(r, 2000)); }
  }
  console.log("[capture] Connected. Drive Progressive PROVE now (log in + search). Ctrl+C when done.\n");

  const wire = (ctx) => {
    for (const p of ctx.pages()) attachToPage(p);
    ctx.on("page", attachToPage);
  };
  for (const ctx of browser.contexts()) wire(ctx);
  browser.on("context", wire);

  const storageScan = setInterval(() => {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) dumpStorage(p);
  }, 3000);

  browser.on("disconnected", () => {
    clearInterval(storageScan);
    console.log("[capture] Browser disconnected — waiting to reconnect…");
    save();
    setTimeout(run, 1500);
  });
  setInterval(save, 5000);
}

run().catch((e) => { console.error("[capture] FATAL:", e.message); process.exit(1); });
