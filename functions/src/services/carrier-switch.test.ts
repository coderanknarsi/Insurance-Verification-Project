import test from "node:test";
import assert from "node:assert/strict";
import { classifySweepOutcome } from "./carrier-switch";

test("explicit cancelled is a true lapse", () => {
  assert.equal(
    classifySweepOutcome({ parsedStatus: "CANCELLED", recordFound: true }),
    "LAPSE",
  );
});

test("no record at carrier with prior active coverage is a possible switch", () => {
  assert.equal(
    classifySweepOutcome({
      parsedStatus: "NOT_AVAILABLE",
      recordFound: false,
      hadPriorCoverage: true,
    }),
    "POSSIBLE_SWITCH",
  );
});

test("active is OK", () => {
  assert.equal(
    classifySweepOutcome({ parsedStatus: "ACTIVE", recordFound: true }),
    "OK",
  );
});

test("no record + no prior coverage stays a lapse (never insured here)", () => {
  assert.equal(
    classifySweepOutcome({
      parsedStatus: "NOT_AVAILABLE",
      recordFound: false,
      hadPriorCoverage: false,
    }),
    "LAPSE",
  );
});
