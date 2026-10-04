/**
 * Uptime arithmetic (FR-004.6). Pure. A device's day uptime is the time spent `online` within the
 * local day, from its status-change timeline; a room's is the average of its devices' days.
 */
import type { DeviceStatus } from '@uniwake/shared';

export interface StatusChange {
  at: number;
  to: DeviceStatus;
}

/** Milliseconds online within `[from, to)`, given the status at `from` and the changes. */
export function onlineMs(
  initial: DeviceStatus,
  changes: readonly StatusChange[],
  from: number,
  to: number,
): number {
  if (to <= from) return 0;
  const inside = changes.filter((c) => c.at >= from && c.at < to).sort((a, b) => a.at - b.at);
  let status = initial;
  let cursor = from;
  let total = 0;
  for (const c of inside) {
    if (status === 'online') total += c.at - cursor;
    status = c.to;
    cursor = c.at;
  }
  if (status === 'online') total += to - cursor;
  return total;
}

/** Average of the known values (AC-004-16); null when none is known. */
export function average(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length;
}
