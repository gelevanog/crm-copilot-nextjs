import { describe, expect, it } from 'vitest';
import { TokenBucketRateLimiter } from '../src/ai/rate-limit/token-bucket';

function limiterWithClock(capacity: number, refillPerMinute: number) {
  let now = 1_000_000;
  const limiter = new TokenBucketRateLimiter({ capacity, refillPerMinute, now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe('TokenBucketRateLimiter', () => {
  it('allows a burst up to capacity, then rejects with a retry hint', () => {
    const { limiter } = limiterWithClock(3, 6); // 1 token every 10s

    expect([1, 2, 3].map(() => limiter.tryConsume('ws:a').allowed)).toEqual([true, true, true]);
    const rejected = limiter.tryConsume('ws:a');
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBe(10_000);
  });

  it('refills continuously over time without exceeding capacity', () => {
    const { limiter, advance } = limiterWithClock(2, 60); // 1 token per second
    limiter.tryConsume('ws:a');
    limiter.tryConsume('ws:a');
    expect(limiter.tryConsume('ws:a').allowed).toBe(false);

    advance(1_000);
    expect(limiter.tryConsume('ws:a').allowed).toBe(true);

    advance(60 * 60_000); // an hour later the bucket is full, not overflowing
    expect(limiter.tryConsume('ws:a').remaining).toBe(1);
  });

  it('keeps separate buckets per workspace', () => {
    const { limiter } = limiterWithClock(1, 1);
    expect(limiter.tryConsume('ws:a').allowed).toBe(true);
    expect(limiter.tryConsume('ws:a').allowed).toBe(false);
    expect(limiter.tryConsume('ws:b').allowed).toBe(true);
  });
});
