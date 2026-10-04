import type { Clock, TimerHandle } from '../../src/application/ports';

interface Timer {
  id: number;
  at: number;
  seq: number;
  fn: () => void;
}

/**
 * Deterministic clock. `advance` fires due timers in time order (FIFO for equal times), including
 * timers scheduled while advancing. `jump` moves wall time (NTP correction, CMOS reset) without
 * firing anything; pending timers keep their remaining delay, as real setTimeout does.
 */
export class FakeClock implements Clock {
  private current: number;
  private timers: Timer[] = [];
  private nextId = 1;
  private seq = 0;

  constructor(start: number | string = Date.UTC(2026, 9, 5, 9, 0, 0)) {
    this.current = typeof start === 'string' ? Date.parse(start) : start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.push({ id, at: this.current + Math.max(0, ms), seq: this.seq++, fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  /** Synchronously fires every timer due within `ms`. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const next = this.popDue(target);
      if (!next) break;
      this.current = next.at;
      next.fn();
    }
    this.current = target;
  }

  /**
   * Like `advance`, but lets promise chains settle between timers, so async code awaiting
   * `sleep()` progresses as it would in real time.
   */
  async advanceAsync(ms: number): Promise<void> {
    const target = this.current + ms;
    await flushMicrotasks();
    for (;;) {
      const next = this.popDue(target);
      if (!next) break;
      this.current = next.at;
      next.fn();
      await flushMicrotasks();
    }
    this.current = target;
    await flushMicrotasks();
  }

  /** Changes wall time without firing timers (NTP correction, CMOS reset). */
  jump(ms: number): void {
    // Like real timers, pending timeouts are monotonic: they keep their remaining delay.
    this.current += ms;
    for (const t of this.timers) t.at += ms;
  }

  set(epochMs: number | string): void {
    this.current = typeof epochMs === 'string' ? Date.parse(epochMs) : epochMs;
  }

  private popDue(target: number): Timer | undefined {
    let best: Timer | undefined;
    for (const t of this.timers) {
      if (t.at > target) continue;
      if (!best || t.at < best.at || (t.at === best.at && t.seq < best.seq)) best = t;
    }
    if (best) this.timers = this.timers.filter((t) => t !== best);
    return best;
  }
}

export async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
