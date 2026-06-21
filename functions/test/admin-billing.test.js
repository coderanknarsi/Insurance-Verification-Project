const test = require("node:test");
const assert = require("node:assert/strict");
const { validateExtendDays, validateDiscount, validatePlan } = require("../lib/functions/admin-billing");

test("extend days must be positive and bounded", () => {
  assert.equal(validateExtendDays(30), 30);
  assert.throws(() => validateExtendDays(0));
  assert.throws(() => validateExtendDays(400));
});

test("discount requires exactly one of percent/amount", () => {
  assert.doesNotThrow(() => validateDiscount({ percentOff: 25 }));
  assert.doesNotThrow(() => validateDiscount({ amountOff: 10 }));
  assert.throws(() => validateDiscount({}));
  assert.throws(() => validateDiscount({ percentOff: 25, amountOff: 10 }));
  assert.throws(() => validateDiscount({ percentOff: 150 }));
});

test("plan must be a known plan", () => {
  assert.equal(validatePlan("SCALE"), "SCALE");
  assert.throws(() => validatePlan("PLATINUM"));
});
