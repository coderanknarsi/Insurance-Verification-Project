import { describe, it } from "node:test";
import assert from "node:assert";
import * as crypto from "crypto";
import { signWebhookBody } from "./outbound-webhook";
import { generateApiKey, hashApiKey } from "../middleware/api-key";

describe("signWebhookBody", () => {
  it("produces a stable HMAC-SHA256 over timestamp.body", () => {
    const sig = signWebhookBody("secret123", "1700000000", '{"a":1}');
    const expected = crypto
      .createHmac("sha256", "secret123")
      .update('1700000000.{"a":1}', "utf8")
      .digest("hex");
    assert.strictEqual(sig, expected);
  });

  it("changes when body, timestamp, or secret change", () => {
    const base = signWebhookBody("s", "1", "{}");
    assert.notStrictEqual(signWebhookBody("s", "1", "{ }"), base);
    assert.notStrictEqual(signWebhookBody("s", "2", "{}"), base);
    assert.notStrictEqual(signWebhookBody("x", "1", "{}"), base);
  });
});

describe("api keys", () => {
  it("generates alt_live_ keys with a display prefix", () => {
    const { rawKey, prefix, keyId } = generateApiKey();
    assert.ok(rawKey.startsWith("alt_live_"));
    assert.ok(rawKey.length > 40);
    assert.ok(rawKey.startsWith(prefix));
    assert.ok(keyId.length > 0);
  });

  it("hashes deterministically and never equals the raw key", () => {
    const { rawKey } = generateApiKey();
    const h1 = hashApiKey(rawKey);
    const h2 = hashApiKey(rawKey);
    assert.strictEqual(h1, h2);
    assert.notStrictEqual(h1, rawKey);
    assert.strictEqual(h1.length, 64); // sha256 hex
  });

  it("two generated keys never collide", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    assert.notStrictEqual(a.rawKey, b.rawKey);
    assert.notStrictEqual(hashApiKey(a.rawKey), hashApiKey(b.rawKey));
  });
});
