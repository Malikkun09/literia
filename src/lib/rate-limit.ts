type Bucket = { stamps: number[]; windowMs: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    const newest = bucket.stamps[bucket.stamps.length - 1] ?? 0;
    if (now - newest >= bucket.windowMs) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number } {
  const existing = buckets.get(key);
  if (!existing && buckets.size >= MAX_BUCKETS) {
    evictExpired(now);
    if (buckets.size >= MAX_BUCKETS) return { ok: false, retryAfterSec: 60 };
  }

  const recent = (existing?.stamps ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    buckets.delete(key);
    buckets.set(key, { stamps: recent, windowMs });
    return { ok: false, retryAfterSec };
  }
  recent.push(now);
  buckets.delete(key);
  buckets.set(key, { stamps: recent, windowMs });
  return { ok: true };
}

export function resetRateLimits(): void {
  buckets.clear();
}
