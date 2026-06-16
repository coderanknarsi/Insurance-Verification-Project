const test = require("node:test");
const assert = require("node:assert/strict");
const { keyMode, isKnownKeyPrefix } = require("../lib/middleware/api-key");

test("live prefix maps to live mode", () => {
  assert.equal(keyMode("alt_live_abc"), "live");
});

test("test prefix maps to test mode", () => {
  assert.equal(keyMode("alt_test_abc"), "test");
});

test("live prefix is a known prefix", () => {
  assert.equal(isKnownKeyPrefix("alt_live_abc"), true);
});

test("test prefix is a known prefix", () => {
  assert.equal(isKnownKeyPrefix("alt_test_abc"), true);
});

test("unknown prefix is rejected", () => {
  assert.equal(isKnownKeyPrefix("xyz_abc"), false);
});
