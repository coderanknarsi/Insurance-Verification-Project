import test from "node:test";
import assert from "node:assert/strict";
import { extractCoverage } from "./coverage-extract";

test("extractCoverage reads rich coverageItems comprehensive + collision deductibles", () => {
  const policy = {
    coverageItems: [
      { type: "Comprehensive", deductibles: [{ amount: 500 }] },
      { type: "Collision", deductibles: [{ amount: 1000 }] },
    ],
  };
  const c = extractCoverage(policy);
  assert.equal(c.hasComprehensive, true);
  assert.equal(c.hasCollision, true);
  assert.equal(c.comprehensiveDeductible, 500);
  assert.equal(c.collisionDeductible, 1000);
});

test("extractCoverage falls back to legacy coverages array", () => {
  const policy = {
    coverages: [{ type: "comprehensive", deductible: 250 }],
  };
  const c = extractCoverage(policy);
  assert.equal(c.hasComprehensive, true);
  assert.equal(c.hasCollision, false);
  assert.equal(c.comprehensiveDeductible, 250);
  assert.equal(c.collisionDeductible, null);
});

test("extractCoverage liability-only policy has no comp/collision", () => {
  const policy = {
    coverageItems: [{ type: "Bodily Injury Liability", deductibles: [] }],
  };
  const c = extractCoverage(policy);
  assert.equal(c.hasComprehensive, false);
  assert.equal(c.hasCollision, false);
});

test("extractCoverage returns null deductible when amount missing", () => {
  const policy = {
    coverageItems: [{ type: "Comprehensive", deductibles: [{ text: "n/a" }] }],
  };
  const c = extractCoverage(policy);
  assert.equal(c.hasComprehensive, true);
  assert.equal(c.comprehensiveDeductible, null);
});
