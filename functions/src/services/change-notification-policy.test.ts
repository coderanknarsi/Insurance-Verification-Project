import test from "node:test";
import assert from "node:assert/strict";
import { decideChangeNotifications } from "./change-notification-policy";
import { PolicyChangeType } from "../types/policy-change";

test("coverage downgrade notifies BOTH borrower and lender", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.COVERAGE_DOWNGRADED, severity: "critical" },
  ]);
  assert.equal(d.notifyBorrower, true);
  assert.equal(d.notifyLender, true);
});

test("carrier change asks borrower to confirm + alerts lender", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.CARRIER_CHANGED, severity: "warning" },
  ]);
  assert.equal(d.notifyBorrower, true);
  assert.equal(d.notifyLender, true);
  assert.equal(d.borrowerTrigger, "VERIFICATION_PROOF_REQUEST");
});

test("reinstatement notifies borrower only (confirmation), info severity", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.POLICY_REINSTATED, severity: "info" },
  ]);
  assert.equal(d.notifyBorrower, true);
  assert.equal(d.notifyLender, false);
  assert.equal(d.borrowerTrigger, "REINSTATEMENT_REMINDER");
});

test("lienholder added is silent (no borrower spam), lender info only", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.LIENHOLDER_ADDED, severity: "info" },
  ]);
  assert.equal(d.notifyBorrower, false);
  assert.equal(d.notifyLender, false);
});

test("highest severity wins for lender alert level", () => {
  const d = decideChangeNotifications([
    { type: PolicyChangeType.DEDUCTIBLE_INCREASED, severity: "warning" },
    { type: PolicyChangeType.POLICY_LAPSED, severity: "critical" },
  ]);
  assert.equal(d.lenderSeverity, "critical");
});
