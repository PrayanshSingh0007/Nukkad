/**
 * A rate limiter. Every key (for example an IP address) owns a bucket of tokens:
 * each action takes one token, and tokens grow back slowly. An empty bucket means "slow down".
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  /**
   * @param capacity   how many actions can happen in a burst
   * @param perMinute  how many tokens grow back per minute
   */
  constructor(capacity: number, perMinute: number, now: () => number = Date.now) {
    this.capacity = capacity;
    this.refillPerMs = perMinute / 60_000;
    this.now = now;
  }

  /** Takes a token. Returns false when the key has none left. */
  consume(key: string): boolean {
    const time = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size > 10_000) this.sweep(time);
      bucket = { tokens: this.capacity, updated: time };
      this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (time - bucket.updated) * this.refillPerMs);
    bucket.updated = time;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Forgets keys whose bucket is full again (they carry no information). */
  private sweep(time: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + (time - bucket.updated) * this.refillPerMs >= this.capacity) this.buckets.delete(key);
    }
  }
}
