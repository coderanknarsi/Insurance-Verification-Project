const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertPayloadWithinLimit,
  MAX_BODY_BYTES,
} = require("../lib/functions/partner-deals-api");

test("small payload is allowed", () => {
  assert.doesNotThrow(() => assertPayloadWithinLimit(1024));
});

test("payload exactly at the limit is allowed", () => {
  assert.doesNotThrow(() => assertPayloadWithinLimit(MAX_BODY_BYTES));
});

test("oversized payload is rejected", () => {
  assert.throws(() => assertPayloadWithinLimit(MAX_BODY_BYTES + 1), /too large|payload/i);
});
