const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSweepAlert } = require("../lib/services/dealer-sweep-alert");

test("clean run produces an informational summary", () => {
  const a = buildSweepAlert({ total: 50, verified: 50, failed: 0, issuesFound: 0 });
  assert.equal(a.severity, "info");
  assert.match(a.subject, /50 verified/);
});

test("run with failures is flagged as a warning", () => {
  const a = buildSweepAlert({ total: 50, verified: 47, failed: 3, issuesFound: 2 });
  assert.equal(a.severity, "warning");
  assert.match(a.subject, /3 failed/);
});

test("fully failed run is flagged critical", () => {
  const a = buildSweepAlert({ total: 50, verified: 0, failed: 50, issuesFound: 0 });
  assert.equal(a.severity, "critical");
});
