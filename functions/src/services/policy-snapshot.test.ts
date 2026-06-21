import test from "node:test";
import assert from "node:assert/strict";
import { extractSnapshot } from "./policy-snapshot";

test("extractSnapshot normalizes carrier and parses expiration to ms", () => {
  const snap = extractSnapshot({
    status: "ACTIVE",
    insuranceProvider: "Progressive",
    policyNumber: "P123",
    coveragePeriod: { startDate: "2026-01-01", endDate: "2026-07-01" },
    isLienholderListed: true,
    dashboardStatus: "GREEN",
    coverageItems: [{ type: "Comprehensive", deductibles: [{ amount: 500 }] }],
  });
  assert.equal(snap.status, "ACTIVE");
  assert.equal(snap.insuranceProvider, "progressive");
  assert.equal(snap.policyNumber, "P123");
  assert.equal(snap.hasComprehensive, true);
  assert.equal(snap.comprehensiveDeductible, 500);
  assert.equal(snap.expirationMs, new Date("2026-07-01").getTime());
  assert.equal(snap.isLienholderListed, true);
  assert.equal(snap.dashboardStatus, "GREEN");
});

test("extractSnapshot handles missing fields safely", () => {
  const snap = extractSnapshot({});
  assert.equal(snap.insuranceProvider, null);
  assert.equal(snap.expirationMs, null);
  assert.equal(snap.isLienholderListed, false);
  assert.equal(snap.hasComprehensive, false);
});
