/**
 * Derives "is this policy's verification stale?" purely from timestamps, so the
 * dashboard can warn a dealer that data is overdue instead of showing a green
 * status backed by a weeks-old (or failed) sweep.
 *
 * Stale when:
 *  - an in-scope policy has never been verified (no lastVerifiedAt), OR
 *  - lastVerifiedAt is older than the staleness threshold.
 * Out-of-scope policies (pending upload, etc.) are never flagged here.
 */
export const STALE_THRESHOLD_MS = 8 * 24 * 60 * 60 * 1000; // 8 days (weekly cadence + grace)

export interface StalenessInput {
  lastVerifiedAtMs: number | null;
  inScope: boolean;
}

export function isVerificationStale(
  input: StalenessInput,
  nowMs: number = Date.now(),
): boolean {
  if (!input.inScope) return false;
  if (input.lastVerifiedAtMs == null) return true;
  return nowMs - input.lastVerifiedAtMs > STALE_THRESHOLD_MS;
}
