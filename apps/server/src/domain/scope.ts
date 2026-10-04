/**
 * Wake scope resolution (spec §4 SR-01..SR-12). Pure: given a snapshot of devices and the
 * devices already in active jobs, decide exactly which devices a request wakes.
 */
import type { DeviceStatus, WakeExclusion, WakeRequestParams, WakeTarget } from '@uniwake/shared';

export interface DeviceSnap {
  id: number;
  name: string;
  mac: string;
  ip: string | null;
  hostname: string | null;
  roomId: number | null;
  tagIds: readonly number[];
  enabled: boolean;
  status: DeviceStatus;
}

export interface Resolution {
  /** Devices that will receive magic packets. */
  devices: DeviceSnap[];
  excluded: WakeExclusion[];
  /** Device ids in a `devices` target that do not exist (SR-04 → 422). */
  unknownIds: number[];
  /** Rooms touched by the resolved set (null = "Sem sala"), with counts. */
  rooms: { roomId: number | null; count: number }[];
}

/** Matches before exclusions (SR-02, SR-03, SR-04, SR-05). */
function matches(target: WakeTarget, d: DeviceSnap): boolean {
  switch (target.type) {
    case 'devices':
      return target.deviceIds.includes(d.id);
    case 'rooms':
      return d.roomId === null ? target.includeNoRoom : target.roomIds.includes(d.roomId);
    case 'tags':
      return d.tagIds.some((t) => target.tagIds.includes(t));
    case 'all':
      return true;
  }
}

export function resolveWake(
  req: Pick<WakeRequestParams, 'target' | 'onlyOffline'>,
  snapshot: readonly DeviceSnap[],
  activeJobByDevice: ReadonlyMap<number, number>,
): Resolution {
  const devices: DeviceSnap[] = [];
  const excluded: WakeExclusion[] = [];
  for (const d of snapshot) {
    if (!matches(req.target, d)) continue;
    if (!d.enabled) {
      excluded.push({ deviceId: d.id, name: d.name, reason: 'disabled' }); // SR-04
      continue;
    }
    if (req.onlyOffline && d.status === 'online') {
      excluded.push({ deviceId: d.id, name: d.name, reason: 'online' }); // SR-06
      continue;
    }
    const jobId = activeJobByDevice.get(d.id);
    if (jobId !== undefined) {
      excluded.push({ deviceId: d.id, name: d.name, reason: 'in_active_job', jobId }); // SR-11
      continue;
    }
    devices.push(d);
  }
  const known = new Set(snapshot.map((d) => d.id));
  const unknownIds =
    req.target.type === 'devices' ? req.target.deviceIds.filter((id) => !known.has(id)) : [];
  const counts = new Map<number | null, number>();
  for (const d of devices) counts.set(d.roomId, (counts.get(d.roomId) ?? 0) + 1);
  return {
    devices,
    excluded,
    unknownIds: [...new Set(unknownIds)],
    rooms: [...counts].map(([roomId, count]) => ({ roomId, count })),
  };
}

/** SR-10: large actions need an explicit confirmation of the exact count. */
export function needsConfirmation(target: WakeTarget, res: Resolution, threshold: number): boolean {
  return target.type === 'all' || res.devices.length > threshold || res.rooms.length > 1;
}
