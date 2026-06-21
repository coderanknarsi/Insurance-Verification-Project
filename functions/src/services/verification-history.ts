export interface RawAttempt {
  policyId: string;
  success?: boolean;
  errorReason?: string | null;
  durationMs?: number | null;
  createdAtMs?: number;
  screenshotPaths?: string[];
}

export interface ShapedAttempt {
  policyId: string;
  success: boolean;
  errorReason: string | null;
  durationMs: number | null;
  createdAtMs: number;
  screenshotPaths: string[];
}

/**
 * Normalize raw `dataFeedRuns/{runId}/results/{policyId}` docs into a stable,
 * newest-first attempt list for the admin support view. Pure — no I/O.
 */
export function shapeAttempts(raw: RawAttempt[]): ShapedAttempt[] {
  return raw
    .map((r) => ({
      policyId: r.policyId,
      success: r.success ?? false,
      errorReason: r.errorReason ?? null,
      durationMs: r.durationMs ?? null,
      createdAtMs: r.createdAtMs ?? 0,
      screenshotPaths: r.screenshotPaths ?? [],
    }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}
