export interface EngineBatchResultSummary {
  successCount: number;
  errorCount: number;
  resultCount: number;
}

interface EngineBatchResponse {
  results?: Array<{ success?: boolean }>;
}

export function summarizeEngineBatchResult(
  responseData: unknown,
  expectedPolicyCount: number,
): EngineBatchResultSummary {
  const response = responseData as EngineBatchResponse | null;
  const results = Array.isArray(response?.results) ? response.results : [];
  const successCount = results.filter((result) => result.success === true).length;
  const failedResultCount = results.length - successCount;
  const missingResultCount = Math.max(0, expectedPolicyCount - results.length);

  return {
    successCount,
    errorCount: failedResultCount + missingResultCount,
    resultCount: results.length,
  };
}