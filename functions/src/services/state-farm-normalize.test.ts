import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeStateFarmScrape } from "./state-farm-normalize";
import { PolicyStatus, DashboardStatus, ComplianceIssue } from "../types/policy";

describe("normalizeStateFarmScrape", () => {
  it("maps an ACTIVE policy with full coverages and lienholder to GREEN-eligible parsed state", () => {
    const r = normalizeStateFarmScrape({
      policyNumber: "ABC-123",
      policyStatus: "Active",
      policyOriginDate: "2025-01-01",
      policyEffectiveDate: "2099-01-01",
      hasCollision: true,
      collisionDeductible: "$500",
      hasComprehensive: true,
      comprehensiveDeductible: "500",
      bodilyInjuryLimitPerAccident: "100000",
      lienholderName: "Big Bank",
      lienholderAddress: "123 Main",
      lossPaye: "Yes",
    });

    assert.equal(r.parsed.status, PolicyStatus.ACTIVE);
    assert.equal(r.parsed.policyNumber, "ABC-123");
    assert.equal(r.parsed.isLienholderListed, true);
    assert.equal(r.parsed.interestedParties[0].name, "Big Bank");
    assert.deepEqual(r.parsed.coveragePeriod, {
      startDate: "2025-01-01",
      endDate: "2099-01-01",
    });
    assert.ok(r.parsed.coverages.find((c) => c.type === "Collision"));
    assert.ok(r.parsed.coverages.find((c) => c.type === "Comprehensive"));
    assert.equal(r.complianceIssues.length, 0);
    assert.equal(r.dashboardStatus, DashboardStatus.GREEN);
  });

  it("flags MISSING_LIENHOLDER when lossPaye is No", () => {
    const r = normalizeStateFarmScrape({
      policyStatus: "Active",
      policyOriginDate: "2025-01-01",
      policyEffectiveDate: "2099-01-01",
      hasCollision: true,
      hasComprehensive: true,
      lienholderName: "Big Bank",
      lossPaye: "No",
    });
    assert.equal(r.parsed.isLienholderListed, false);
    assert.ok(r.complianceIssues.includes(ComplianceIssue.MISSING_LIENHOLDER));
    assert.equal(r.dashboardStatus, DashboardStatus.RED);
  });

  it("flags NO_COLLISION / NO_COMPREHENSIVE when coverages absent", () => {
    const r = normalizeStateFarmScrape({
      policyStatus: "Active",
      policyOriginDate: "2025-01-01",
      policyEffectiveDate: "2099-01-01",
      hasCollision: false,
      hasComprehensive: false,
      lienholderName: "Big Bank",
      lossPaye: "Yes",
    });
    assert.ok(r.complianceIssues.includes(ComplianceIssue.NO_COLLISION));
    assert.ok(r.complianceIssues.includes(ComplianceIssue.NO_COMPREHENSIVE));
    assert.equal(r.dashboardStatus, DashboardStatus.RED);
  });

  it("maps CANCELLED string to POLICY_CANCELLED + RED", () => {
    const r = normalizeStateFarmScrape({
      policyStatus: "Cancelled",
    });
    assert.equal(r.parsed.status, PolicyStatus.CANCELLED);
    assert.ok(r.complianceIssues.includes(ComplianceIssue.POLICY_CANCELLED));
    assert.equal(r.dashboardStatus, DashboardStatus.RED);
  });

  it("maps unknown status to NOT_AVAILABLE", () => {
    const r = normalizeStateFarmScrape({ policyStatus: "WHO KNOWS" });
    assert.equal(r.parsed.status, PolicyStatus.NOT_AVAILABLE);
  });

  it("treats string 'true' the same as boolean true for coverage flags", () => {
    const r = normalizeStateFarmScrape({
      policyStatus: "Active",
      policyOriginDate: "2025-01-01",
      policyEffectiveDate: "2099-01-01",
      hasCollision: "true",
      hasComprehensive: "true",
      lienholderName: "Big Bank",
      lossPaye: "Yes",
    });
    assert.ok(r.parsed.coverages.find((c) => c.type === "Collision"));
    assert.ok(r.parsed.coverages.find((c) => c.type === "Comprehensive"));
  });
});
