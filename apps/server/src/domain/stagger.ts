/**
 * Staggered wake planning (FR-003.4, SR-12). Each room is split into batches using its own
 * batch size and delay; rooms run in parallel; a global cap limits how many devices start in the
 * same step (inrush current on shared circuits, phase-1 D1-06). Pure.
 */

export interface StaggerSettings {
  batchSize: number;
  delayMs: number;
}

export interface StaggerDevice {
  deviceId: number;
  roomId: number | null;
}

export interface Step {
  atMs: number;
  deviceIds: number[];
}

export function planStagger(
  devices: readonly StaggerDevice[],
  settingsFor: (roomId: number | null) => StaggerSettings,
  cap: number,
  /** Gap used when the cap pushes devices to a later step. */
  capDelayMs: number,
): Step[] {
  if (devices.length === 0) return [];
  const limit = Math.max(1, cap);
  const gap = Math.max(1000, capDelayMs);

  // Batches per room, in the order rooms first appear.
  const byRoom = new Map<number | null, number[]>();
  for (const d of devices) {
    const list = byRoom.get(d.roomId) ?? [];
    list.push(d.deviceId);
    byRoom.set(d.roomId, list);
  }
  const events: { atMs: number; order: number; deviceIds: number[] }[] = [];
  let order = 0;
  for (const [roomId, ids] of byRoom) {
    const s = settingsFor(roomId);
    const size = Math.max(1, s.batchSize);
    for (let i = 0, k = 0; i < ids.length; i += size, k++) {
      events.push({
        atMs: k * Math.max(0, s.delayMs),
        order: order++,
        deviceIds: ids.slice(i, i + size),
      });
    }
  }
  events.sort((a, b) => a.atMs - b.atMs || a.order - b.order);

  // Place batches into time buckets respecting the global cap; overflow moves to later slots.
  const buckets = new Map<number, number[]>();
  for (const e of events) {
    let at = e.atMs;
    let remaining = e.deviceIds;
    while (remaining.length > 0) {
      const bucket = buckets.get(at) ?? [];
      const room = limit - bucket.length;
      if (room > 0) {
        bucket.push(...remaining.slice(0, room));
        buckets.set(at, bucket);
        remaining = remaining.slice(room);
      }
      at += gap;
    }
  }
  return [...buckets].sort(([a], [b]) => a - b).map(([atMs, deviceIds]) => ({ atMs, deviceIds }));
}
