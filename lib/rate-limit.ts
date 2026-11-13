export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
};

type Bucket = { count: number; resetAt: number };

/**
 * In-memory fixed-window counters. This is per process: with several replicas
 * each one enforces its own budget, so the effective limit scales with replica
 * count. That is acceptable as a cost guard for the public chat endpoint; swap
 * in a shared store (Redis/Postgres) if strict global limits are ever needed.
 */
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

export const CHAT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };
export const WEB_SEARCH_BUDGET = { limit: 60, windowMs: 60 * 60 * 1000 };

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (buckets.size >= MAX_BUCKETS) pruneExpired(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      resetAt,
    };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    resetAt: existing.resetAt,
  };
}

/** Best-effort client identity behind Railway's proxy. */
export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    forwarded ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

/** Global hourly allowance for paid web searches, shared by all visitors. */
export function takeWebSearchBudget(): boolean {
  return consumeRateLimit(
    "global:web-search",
    WEB_SEARCH_BUDGET.limit,
    WEB_SEARCH_BUDGET.windowMs,
  ).allowed;
}
