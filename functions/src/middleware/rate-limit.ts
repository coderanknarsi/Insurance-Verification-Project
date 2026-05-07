import { HttpsError } from "firebase-functions/v2/https";

/**
 * Lightweight in-memory rate limiter. Best-effort defense for public /
 * expensive callable endpoints. Each Cloud Functions instance keeps its own
 * map; under load the platform may scale to multiple instances, so this is
 * not a hard guarantee — pair with platform-level controls (Cloud Armor,
 * App Check, etc.) for production-grade abuse prevention.
 */
interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  options: { windowMs: number; max: number },
): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > options.windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > options.max) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many requests. Please try again in a moment.",
    );
  }
}

/**
 * Periodically clear stale buckets to avoid unbounded memory growth.
 * Called opportunistically; not scheduled.
 */
export function gcRateLimitBuckets(maxAgeMs: number = 10 * 60 * 1000): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}
