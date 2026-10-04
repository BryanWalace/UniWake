import type { Clock, TimerHandle } from '../application/ports';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  }

  clearTimeout(handle: TimerHandle): void {
    clearTimeout(handle as NodeJS.Timeout);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
