export interface TokenBucketOptions {
  /** Maximum burst size. */
  capacity: number;
  /** Tokens added per minute (continuous refill). */
  refillPerMinute: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the request would be allowed (0 when allowed). */
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * In-memory token bucket keyed by workspace. Good for a single API instance;
 * with several replicas the same interface can be backed by Redis or Postgres.
 */
export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly refillPerMs: number;

  constructor(private readonly opts: TokenBucketOptions) {
    this.now = opts.now ?? Date.now;
    this.refillPerMs = opts.refillPerMinute / 60_000;
  }

  get capacity(): number {
    return this.opts.capacity;
  }

  get refillPerMinute(): number {
    return this.opts.refillPerMinute;
  }

  tryConsume(key: string, cost = 1): ConsumeResult {
    const now = this.now();
    const bucket = this.refill(key, now);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }
    const missing = cost - bucket.tokens;
    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: Math.ceil(missing / this.refillPerMs),
    };
  }

  private refill(key: string, now: number): Bucket {
    const existing = this.buckets.get(key);
    if (!existing) {
      this.evictFullBuckets(now);
      const bucket = { tokens: this.opts.capacity, updatedAt: now };
      this.buckets.set(key, bucket);
      return bucket;
    }
    const elapsed = Math.max(0, now - existing.updatedAt);
    existing.tokens = Math.min(this.opts.capacity, existing.tokens + elapsed * this.refillPerMs);
    existing.updatedAt = now;
    return existing;
  }

  /** Keeps memory bounded: a full bucket is equivalent to no bucket. */
  private evictFullBuckets(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [key, b] of this.buckets) {
      if (b.tokens + (now - b.updatedAt) * this.refillPerMs >= this.opts.capacity)
        this.buckets.delete(key);
    }
  }
}
