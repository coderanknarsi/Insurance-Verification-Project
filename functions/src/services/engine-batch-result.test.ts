import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeEngineBatchResult } from "./engine-batch-result";

describe("summarizeEngineBatchResult", () => {
  it("counts individual failed engine results even when the batch request succeeds", () => {
    const summary = summarizeEngineBatchResult(
      {
        results: [
          { success: false },
          { success: true },
        ],
      },
      2,
    );

    assert.deepEqual(summary, {
      successCount: 1,
      errorCount: 1,
      resultCount: 2,
    });
  });

  it("counts missing or malformed engine results as errors", () => {
    const summary = summarizeEngineBatchResult({ results: [{ success: true }] }, 3);

    assert.deepEqual(summary, {
      successCount: 1,
      errorCount: 2,
      resultCount: 1,
    });
  });
});