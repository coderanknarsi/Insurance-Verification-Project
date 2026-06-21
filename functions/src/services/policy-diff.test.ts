import test from "node:test";
import assert from "node:assert/strict";
import { diffPolicySnapshot } from "./policy-diff";
import { PolicyChangeType } from "../types/policy-change";
import type { PolicySnapshot } from "../types/policy-change";

const base: PolicySnapshot = {
  status: "ACTIVE",
  insuranceProvider: "progressive",
  policyNumber: "P1",
  hasComprehensive: true,
  hasCollision: true,
  comprehensiveDeductible: 500,
  collisionDeductible: 500,
  expirationMs: new Date("2026-12-01").getTime(),
  isLienholderListed: true,
  dashboardStatus: "GREEN",
};

function types(changes: { type: PolicyChangeType }[]) {
  return changes.map((c) => c.type);
}

test("no change yields empty list", () => {
  assert.deepEqual(diffPolicySnapshot(base, { ...base }), []);
});

test("carrier switch detected", () => {
  const changes = diffPolicySnapshot(base, { ...base, insuranceProvider: "state_farm" });
  assert.ok(types(changes).includes(PolicyChangeType.CARRIER_CHANGED));
});

test("comprehensive dropped is a downgrade (critical)", () => {
  const changes = diffPolicySnapshot(base, {
    ...base,
    hasComprehensive: false,
    comprehensiveDeductible: null,
  });
  const dg = changes.find((c) => c.type === PolicyChangeType.COVERAGE_DOWNGRADED);
  assert.ok(dg);
  assert.equal(dg!.severity, "critical");
});

test("deductible increase detected with summary", () => {
  const changes = diffPolicySnapshot(base, { ...base, comprehensiveDeductible: 1500 });
  const d = changes.find((c) => c.type === PolicyChangeType.DEDUCTIBLE_INCREASED);
  assert.ok(d);
  assert.equal(d!.previousValue, 500);
  assert.equal(d!.newValue, 1500);
});

test("deductible decrease is NOT flagged", () => {
  const changes = diffPolicySnapshot(base, { ...base, comprehensiveDeductible: 250 });
  assert.equal(
    changes.find((c) => c.type === PolicyChangeType.DEDUCTIBLE_INCREASED),
    undefined,
  );
});

test("expiration moved earlier is flagged", () => {
  const changes = diffPolicySnapshot(base, {
    ...base,
    expirationMs: new Date("2026-08-01").getTime(),
  });
  assert.ok(types(changes).includes(PolicyChangeType.EXPIRATION_MOVED_UP));
});

test("expiration extended is NOT flagged", () => {
  const changes = diffPolicySnapshot(base, {
    ...base,
    expirationMs: new Date("2027-12-01").getTime(),
  });
  assert.equal(types(changes).includes(PolicyChangeType.EXPIRATION_MOVED_UP), false);
});

test("lapse detected when active -> cancelled", () => {
  const changes = diffPolicySnapshot(base, { ...base, status: "CANCELLED" });
  const lapse = changes.find((c) => c.type === PolicyChangeType.POLICY_LAPSED);
  assert.ok(lapse);
  assert.equal(lapse!.severity, "critical");
});

test("reinstatement detected when cancelled -> active", () => {
  const lapsed = { ...base, status: "CANCELLED" };
  const changes = diffPolicySnapshot(lapsed, { ...base, status: "ACTIVE" });
  assert.ok(types(changes).includes(PolicyChangeType.POLICY_REINSTATED));
});

test("lienholder removed flagged critical", () => {
  const changes = diffPolicySnapshot(base, { ...base, isLienholderListed: false });
  const lh = changes.find((c) => c.type === PolicyChangeType.LIENHOLDER_REMOVED);
  assert.ok(lh);
  assert.equal(lh!.severity, "critical");
});
