const test = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldRetry,
  backoffMs,
  MAX_WEBHOOK_ATTEMPTS,
} = require("../lib/services/outbound-webhook");

test("2xx never retries", () => {
  assert.equal(shouldRetry(200, 1, MAX_WEBHOOK_ATTEMPTS), false);
});

test("5xx retries until max attempts", () => {
  assert.equal(shouldRetry(503, 1, MAX_WEBHOOK_ATTEMPTS), true);
  assert.equal(shouldRetry(503, MAX_WEBHOOK_ATTEMPTS, MAX_WEBHOOK_ATTEMPTS), false);
});

test("network error (status 0) retries", () => {
  assert.equal(shouldRetry(0, 1, MAX_WEBHOOK_ATTEMPTS), true);
});

test("backoff grows with attempt", () => {
  assert.ok(backoffMs(2) > backoffMs(1));
});
