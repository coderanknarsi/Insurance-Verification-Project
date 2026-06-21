const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOverrideUpdate } = require("../lib/functions/admin-override-policy");

test("buildOverrideUpdate sets status and clears error", () => {
  const u = buildOverrideUpdate({ dashboardStatus: "GREEN", note: "called carrier, active" }, "admin@x.com");
  assert.equal(u.dashboardStatus, "GREEN");
  assert.equal(u.verificationSource, "manual-override");
  assert.equal(u.overriddenBy, "admin@x.com");
  assert.equal(u.overrideNote, "called carrier, active");
  assert.ok("lastVerifiedAt" in u);
  assert.ok("lastVerificationError" in u);
});

test("buildOverrideUpdate defaults note to null", () => {
  const u = buildOverrideUpdate({ dashboardStatus: "RED" }, "admin@x.com");
  assert.equal(u.overrideNote, null);
});

test("buildOverrideUpdate rejects unknown status", () => {
  assert.throws(() => buildOverrideUpdate({ dashboardStatus: "PURPLE" }, "a@x.com"));
});
