type Bucket = number[];

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function evictExpired(now: number): void {
  for (const [key, stamps] of buckets) {
    const newest = stamps[stamps.length - 1] ?? 0;
    if (now - newest >= 10 * 60 * 1000) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing && buckets.size >= MAX_BUCKETS) {
    evictExpired(now);
    if (buckets.size >= MAX_BUCKETS) return { ok: false, retryAfterSec: 60 };
  }

  const recent = (existing ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    buckets.delete(key);
    buckets.set(key, recent);
    return { ok: false, retryAfterSec };
  }
  recent.push(now);
  buckets.delete(key);
  buckets.set(key, recent);
  return { ok: true };
}

export function resetRateLimits(): void {
  buckets.clear();
}
