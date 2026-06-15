const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isVerificationStale,
  STALE_THRESHOLD_MS,
} = require("../lib/services/verification-staleness");

test("fresh verification is not stale", () => {
  const now = Date.now();
  assert.equal(
    isVerificationStale({ lastVerifiedAtMs: now - 60_000, inScope: true }, now),
    false,
  );
});

test("verification older than threshold is stale", () => {
  const now = Date.now();
  assert.equal(
    isVerificationStale(
      { lastVerifiedAtMs: now - STALE_THRESHOLD_MS - 1, inScope: true },
      now,
    ),
    true,
  );
});

test("in-scope policy never verified is stale", () => {
  const now = Date.now();
  assert.equal(
    isVerificationStale({ lastVerifiedAtMs: null, inScope: true }, now),
    true,
  );
});

test("out-of-scope policy (pending upload) is not flagged stale", () => {
  const now = Date.now();
  assert.equal(
    isVerificationStale({ lastVerifiedAtMs: null, inScope: false }, now),
    false,
  );
});
