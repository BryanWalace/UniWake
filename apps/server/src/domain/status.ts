/**
 * Device status state machine (FR-004.1, ADR-014). Pure.
 * - Any positive probe (ICMP reply, TCP connect, TCP refused) → online, immediately.
 * - An online device becomes offline only after `offlineAfter` consecutive failed sweeps
 *   (debounce against packet loss); from unknown, one failed sweep is enough.
 * - No usable address → desconhecido.
 */
import type { DeviceStatus } from '@uniwake/shared';

export interface StatusState {
  status: DeviceStatus;
  latencyMs: number | null;
  lastSeenAt: number | null;
  onlineSince: number | null;
  lastProbeAt: number | null;
  consecutiveFailures: number;
  everOnline: boolean;
}

export type ProbeOutcome =
  { kind: 'alive'; latencyMs: number | null } | { kind: 'dead' } | { kind: 'no_address' };

export const UNKNOWN_STATE: StatusState = {
  status: 'desconhecido',
  latencyMs: null,
  lastSeenAt: null,
  onlineSince: null,
  lastProbeAt: null,
  consecutiveFailures: 0,
  everOnline: false,
};

export function nextStatus(
  prev: StatusState,
  outcome: ProbeOutcome,
  now: number,
  offlineAfter: number,
): { next: StatusState; changed: boolean } {
  let next: StatusState;
  switch (outcome.kind) {
    case 'alive':
      next = {
        status: 'online',
        latencyMs: outcome.latencyMs,
        lastSeenAt: now,
        onlineSince: prev.status === 'online' ? (prev.onlineSince ?? now) : now,
        lastProbeAt: now,
        consecutiveFailures: 0,
        everOnline: true,
      };
      break;
    case 'dead': {
      const failures = prev.consecutiveFailures + 1;
      const stillOnline = prev.status === 'online' && failures < Math.max(1, offlineAfter);
      next = {
        ...prev,
        status: stillOnline ? 'online' : 'offline',
        latencyMs: stillOnline ? prev.latencyMs : null,
        onlineSince: stillOnline ? prev.onlineSince : null,
        lastProbeAt: now,
        consecutiveFailures: failures,
      };
      break;
    }
    case 'no_address':
      next = {
        ...prev,
        status: 'desconhecido',
        latencyMs: null,
        onlineSince: null,
        lastProbeAt: now,
        consecutiveFailures: 0,
      };
      break;
  }
  return { next, changed: next.status !== prev.status };
}
