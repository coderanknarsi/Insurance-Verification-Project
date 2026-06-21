const test = require("node:test");
const assert = require("node:assert/strict");
const { shapeAttempts } = require("../lib/services/verification-history");

test("shapeAttempts maps and sorts newest-first", () => {
  const raw = [
    { policyId: "p1", success: false, errorReason: "login failed", durationMs: 1200, createdAtMs: 1000 },
    { policyId: "p1", success: true, errorReason: null, durationMs: 800, createdAtMs: 5000 },
  ];
  const out = shapeAttempts(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].createdAtMs, 5000); // newest first
  assert.equal(out[0].success, true);
  assert.equal(out[1].errorReason, "login failed");
});

test("shapeAttempts tolerates missing fields", () => {
  const out = shapeAttempts([{ policyId: "p1" }]);
  assert.equal(out[0].success, false);
  assert.equal(out[0].errorReason, null);
  assert.equal(out[0].durationMs, null);
  assert.equal(out[0].createdAtMs, 0);
});

test("shapeAttempts returns [] for empty input", () => {
  assert.deepEqual(shapeAttempts([]), []);
});
