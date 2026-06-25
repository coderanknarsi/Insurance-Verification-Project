import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeAllstateScrape } from "./allstate-normalize";
import { PolicyStatus, DashboardStatus, ComplianceIssue } from "../types/policy";

describe("normalizeAllstateScrape", () => {
  it("maps an ACTIVE policy with deductibles, term dates, and LPC lienholder to GREEN", () => {
    const r = normalizeAllstateScrape({
      policyNumber: "869287160",
      insuredName: "Edith Kreischer",
      companyName: "ALLSTATE NORTH AMERICAN INSURANCE COMPANY",
      policyEffectiveDate: "06/03/2099",
      policyExpirationDate: "12/03/2099",
      policyStatus: "Active",
      vin: "1FADP3F22EL262279",
      modelName: "Focus",
      modelYear: "2014",
      bodilyInjuryLimit: "15000",
      propertyDamageLimit: "100000",
      hasCollision: true,
      collisionDeductible: "500",
      hasComprehensive: true,
      comprehensiveDeductible: "500",
      lienholderName: "Fast Auto Credit",
      lienholderAddress: "PO BOX 421669",
      lienholderCityStateZip: "ATLANTA, GA 30342",
      loanExpiration: "2028",
    });

    assert.equal(r.parsed.status, PolicyStatus.ACTIVE);
    assert.equal(r.parsed.policyNumber, "869287160");
    assert.equal(r.parsed.insuranceProvider, "Allstate");
    assert.equal(
      r.parsed.insuranceProviderDetail?.name,
      "ALLSTATE NORTH AMERICAN INSURANCE COMPANY",
    );
    assert.deepEqual(r.parsed.coveragePeriod, {
      startDate: "2099-06-03",
      endDate: "2099-12-03",
    });
    assert.equal(r.parsed.isLienholderListed, true);
    assert.equal(r.parsed.interestedParties[0].name, "Fast Auto Credit");
    assert.deepEqual(r.parsed.interestedParties[0].address, {
      addr1: "PO BOX 421669",
      city: "ATLANTA",
      state: "GA",
      zipcode: "30342",
    });
    const collision = r.parsed.coverages.find((c) => c.type === "Collision");
    const comprehensive = r.parsed.coverages.find(
      (c) => c.type === "Comprehensive",
    );
    assert.equal(collision?.deductible, 500);
    assert.equal(comprehensive?.deductible, 500);
    assert.equal(r.complianceIssues.length, 0);
    assert.equal(r.dashboardStatus, DashboardStatus.GREEN);
  });

  it("derives collision/comprehensive from a deductible value even without a flag", () => {
    const r = normalizeAllstateScrape({
      policyStatus: "Active",
      policyEffectiveDate: "01/01/2099",
      policyExpirationDate: "07/01/2099",
      collisionDeductible: "1000",
      comprehensiveDeductible: "250",
      lienholderName: "Big Bank",
      lienholderCityStateZip: "DALLAS, TX 75001",
    });
    assert.ok(r.parsed.coverages.find((c) => c.type === "Collision"));
    assert.ok(r.parsed.coverages.find((c) => c.type === "Comprehensive"));
    assert.equal(r.parsed.isLienholderListed, true);
  });

  it("flags MISSING_LIENHOLDER when no LPC is listed", () => {
    const r = normalizeAllstateScrape({
      policyStatus: "Active",
      policyEffectiveDate: "01/01/2099",
      policyExpirationDate: "07/01/2099",
      hasCollision: true,
      hasComprehensive: true,
    });
    assert.equal(r.parsed.isLienholderListed, false);
    assert.ok(r.complianceIssues.includes(ComplianceIssue.MISSING_LIENHOLDER));
    assert.equal(r.dashboardStatus, DashboardStatus.RED);
  });

  it("flags NO_COLLISION / NO_COMPREHENSIVE when coverages absent", () => {
    const r = normalizeAllstateScrape({
      policyStatus: "Active",
      policyEffectiveDate: "01/01/2099",
      policyExpirationDate: "07/01/2099",
      lienholderName: "Big Bank",
    });
    assert.ok(r.complianceIssues.includes(ComplianceIssue.NO_COLLISION));
    assert.ok(r.complianceIssues.includes(ComplianceIssue.NO_COMPREHENSIVE));
    assert.equal(r.dashboardStatus, DashboardStatus.RED);
  });

  it("maps a CANCELLED policy to POLICY_CANCELLED + RED and records cancel date", () => {
    const r = normalizeAllstateScrape({
      policyNumber: "869287160",
      policyStatus: "Cancel",
      cancelDate: "03/15/2026",
      lienholderName: "Fast Auto Credit",
    });
    assert.equal(r.parsed.status, PolicyStatus.CANCELLED);
    assert.equal(r.parsed.cancelledDate, "2026-03-15");
    assert.ok(r.complianceIssues.includes(ComplianceIssue.POLICY_CANCELLED));
    assert.equal(r.dashboardStatus, DashboardStatus.RED);
  });

  it("treats N/A scraped values as absent", () => {
    const r = normalizeAllstateScrape({
      policyStatus: "Active",
      policyEffectiveDate: "01/01/2099",
      policyExpirationDate: "07/01/2099",
      hasCollision: true,
      hasComprehensive: true,
      lienholderName: "N/A",
      cancelDate: "N/A",
    });
    assert.equal(r.parsed.interestedParties.length, 0);
    assert.equal(r.parsed.isLienholderListed, false);
  });

  it("maps unknown status to NOT_AVAILABLE", () => {
    const r = normalizeAllstateScrape({ policyStatus: "WHO KNOWS" });
    assert.equal(r.parsed.status, PolicyStatus.NOT_AVAILABLE);
  });
});
