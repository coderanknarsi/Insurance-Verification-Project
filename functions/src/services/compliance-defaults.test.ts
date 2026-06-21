import test from "node:test";
import assert from "node:assert/strict";
import { defaultComplianceRules } from "./compliance-defaults";
import { OrganizationType } from "../types/organization";

test("defaults require comprehensive, collision, and lienholder", () => {
  const rules = defaultComplianceRules(OrganizationType.BHPH_DEALER);
  assert.equal(rules.requireComprehensive, true);
  assert.equal(rules.requireCollision, true);
  assert.equal(rules.requireLienholder, true);
});

test("defaults cap comp and collision deductibles", () => {
  const rules = defaultComplianceRules(OrganizationType.BANK);
  assert.equal(rules.maxCompDeductible, 1000);
  assert.equal(rules.maxCollisionDeductible, 1000);
});

test("defaults include escalation cadences as fresh copies", () => {
  const a = defaultComplianceRules();
  const b = defaultComplianceRules();
  assert.deepEqual(a.lapseEscalation, { firstNoticeDays: 1, secondNoticeDays: 10, finalNoticeDays: 20 });
  assert.deepEqual(a.coverageEscalation, { firstNoticeDays: 1, secondNoticeDays: 14, finalNoticeDays: 30 });
  // Mutating one copy must not leak into another.
  a.lapseEscalation!.firstNoticeDays = 99;
  assert.equal(b.lapseEscalation!.firstNoticeDays, 1);
});

test("defaults set autoSendReminder and a timezone", () => {
  const rules = defaultComplianceRules();
  assert.equal(rules.autoSendReminder, true);
  assert.equal(typeof rules.timezone, "string");
  assert.equal(rules.reminderDaysBeforeExpiry, 14);
});
