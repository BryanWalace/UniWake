/**
 * ADR-039: one executor per run among the PCs that are on. The candidates are this PC and the
 * non-revoked members seen in the last 60 s, ordered by instance id; the first handles the run, and
 * each next one takes over 90 s later if no record has arrived (the scheduler keeps asking).
 */
import type { ExecutionLease } from '../schedules/scheduler';

export const FALLBACK_MS = 90_000;

export interface TeamLeaseDeps {
  inTeam: () => boolean;
  self: () => string;
  /** Members seen recently (excluding this PC). */
  online: (now: number) => string[];
}

export class TeamLease implements ExecutionLease {
  constructor(private readonly d: TeamLeaseDeps) {}

  /** Position of this PC among the candidates (0 = elected). */
  rank(now: number): number {
    const self = this.d.self();
    return [self, ...this.d.online(now).filter((i) => i !== self)].sort().indexOf(self);
  }

  shouldHandle(o: { plannedAt: number; now: number }): boolean {
    if (!this.d.inTeam()) return true;
    const rank = this.rank(o.now);
    return rank === 0 || o.now >= o.plannedAt + FALLBACK_MS * rank;
  }
}
