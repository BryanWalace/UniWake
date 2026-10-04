/**
 * Keyed sliding-window limiter driven by the injected clock (plan §4: per-user wake limits and
 * per-account login backoff need custom keys and deterministic tests).
 */
import type { Clock } from './ports';

export class KeyedLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly windowMs: number,
    private readonly limit: () => number,
  ) {}

  /** Records a hit; returns false when the key is over its limit in the current window. */
  hit(key: string): boolean {
    const now = this.clock.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit()) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [k, v] of this.hits)
      if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}
