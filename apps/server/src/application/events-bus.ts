/**
 * In-process events (plan §2.1, §6.3). Services publish; the SSE route (M4) subscribes.
 * Listener errors are isolated so one bad subscriber cannot break a wake job.
 */
import type { DeviceResult, JobState, JobSummary } from '@uniwake/shared';

export type HubEvent =
  | { type: 'job.progress'; jobId: number; state: JobState; summary: JobSummary }
  | { type: 'job.device'; jobId: number; deviceId: number; result: DeviceResult }
  | {
      type: 'device.status';
      deviceId: number;
      status: string;
      latencyMs: number | null;
      lastSeenAt: number | null;
    }
  | { type: 'counters' }
  | { type: 'notice'; id: number; noticeType: string }
  | { type: 'scheduler'; paused: boolean };

export type HubListener = (e: HubEvent) => void;

export class EventsBus {
  private listeners = new Set<HubListener>();

  subscribe(listener: HubListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(e: HubEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // a failing subscriber must not affect publishers
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
