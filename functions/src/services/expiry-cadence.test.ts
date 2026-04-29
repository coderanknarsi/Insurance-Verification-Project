import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BUMPED_DAYS, CadenceMode, shouldRemindAt } from "./expiry-cadence";

describe("shouldRemindAt — BUMPED", () => {
  it("reminds on each bumped day", () => {
    for (const d of BUMPED_DAYS) {
      assert.equal(shouldRemindAt(d, CadenceMode.BUMPED, 10), true);
    }
  });

  it("does NOT remind on a day outside the bumped set", () => {
    assert.equal(shouldRemindAt(20, CadenceMode.BUMPED, 30), false);
    assert.equal(shouldRemindAt(2, CadenceMode.BUMPED, 30), false);
    assert.equal(shouldRemindAt(5, CadenceMode.BUMPED, 30), false);
  });

  it("never reminds for past expiries", () => {
    assert.equal(shouldRemindAt(-1, CadenceMode.BUMPED, 10), false);
  });

  it("ignores orgReminderDays in BUMPED mode", () => {
    // Day 7 is bumped — true regardless of org threshold
    assert.equal(shouldRemindAt(7, CadenceMode.BUMPED, 0), true);
    // Day 5 is NOT bumped — false even with high threshold
    assert.equal(shouldRemindAt(5, CadenceMode.BUMPED, 60), false);
  });
});

describe("shouldRemindAt — STANDARD", () => {
  it("reminds for any day within org window", () => {
    assert.equal(shouldRemindAt(10, CadenceMode.STANDARD, 10), true);
    assert.equal(shouldRemindAt(0, CadenceMode.STANDARD, 10), true);
    assert.equal(shouldRemindAt(5, CadenceMode.STANDARD, 10), true);
  });

  it("does not remind beyond org window", () => {
    assert.equal(shouldRemindAt(11, CadenceMode.STANDARD, 10), false);
  });

  it("never reminds for past expiries", () => {
    assert.equal(shouldRemindAt(-1, CadenceMode.STANDARD, 10), false);
  });
});

describe("BUMPED_DAYS contents", () => {
  it("contains the agreed set 30/14/7/3/1/0", () => {
    assert.deepEqual([...BUMPED_DAYS].sort((a, b) => a - b), [0, 1, 3, 7, 14, 30]);
  });
});
