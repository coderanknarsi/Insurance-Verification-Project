const test = require("node:test");
const assert = require("node:assert/strict");
const { effectiveMonthly } = require("../lib/types/subscription");

test("base plan price when no adjustments", () => {
  assert.equal(effectiveMonthly("STARTER", {}), 49);
});

test("priceOverride wins over plan", () => {
  assert.equal(effectiveMonthly("SCALE", { priceOverrideMonthly: 150 }), 150);
});

test("percent discount applies to plan price", () => {
  assert.equal(effectiveMonthly("GROWTH", { discountPercent: 50 }), 49.5);
});

test("comped org is 0", () => {
  assert.equal(effectiveMonthly("SCALE", { compedAt: 1234 }), 0);
});
