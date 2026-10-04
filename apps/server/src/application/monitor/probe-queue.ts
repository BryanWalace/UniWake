/**
 * One bounded pool of probes shared by sweeps (low priority) and wake verification (high
 * priority), so verification never waits behind a 500-device sweep (FR-004.2, AC-004-13).
 * Each address is probed individually; the ICMP adapter batches concurrent pings itself.
 */
import type { Prober, ProbeOptions, ProbeResult } from '../ports';

export type Priority = 'high' | 'low';

interface Task {
  address: string;
  opts: ProbeOptions;
  resolve: (r: ProbeResult) => void;
}

const NO_ANSWER: ProbeResult = { alive: false, via: null, latencyMs: null };

export class ProbeQueue {
  private readonly queues: Record<Priority, Task[]> = { high: [], low: [] };
  private active = 0;

  constructor(
    private readonly prober: Prober,
    private readonly concurrency: () => number,
  ) {}

  probe(
    addresses: readonly string[],
    opts: ProbeOptions,
    priority: Priority,
  ): Promise<Map<string, ProbeResult>> {
    const unique = [...new Set(addresses)];
    return Promise.all(
      unique.map(
        (address) =>
          new Promise<ProbeResult>((resolve) => {
            this.queues[priority].push({ address, opts, resolve });
            this.pump();
          }),
      ),
    ).then((results) => new Map(unique.map((a, i) => [a, results[i]!])));
  }

  /** A Prober view bound to one priority (verifier → high, monitor → low). */
  at(priority: Priority): Prober {
    return { probe: (addresses, opts) => this.probe(addresses, opts, priority) };
  }

  /** Answers every queued (not yet started) probe of that priority as "no answer". */
  cancelPending(priority: Priority): number {
    const dropped = this.queues[priority].splice(0);
    for (const t of dropped) t.resolve(NO_ANSWER);
    return dropped.length;
  }

  get pending(): { high: number; low: number; active: number } {
    return { high: this.queues.high.length, low: this.queues.low.length, active: this.active };
  }

  private pump() {
    while (this.active < Math.max(1, this.concurrency())) {
      const task = this.queues.high.shift() ?? this.queues.low.shift();
      if (!task) return;
      this.active++;
      void this.prober
        .probe([task.address], task.opts)
        .then((m) => m.get(task.address) ?? NO_ANSWER)
        .catch(() => NO_ANSWER)
        .then((r) => {
          this.active--;
          task.resolve(r);
          this.pump();
        });
    }
  }
}
