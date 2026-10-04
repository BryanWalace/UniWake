import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type DeviceStatus, type WakeTarget, wakeRequestSchema } from '@uniwake/shared';
import { type DeviceSnap, needsConfirmation, resolveWake } from '../src/domain/scope';

let nextId = 1;
const dev = (p: Partial<DeviceSnap> = {}): DeviceSnap => {
  const id = nextId++;
  return {
    id,
    name: `PC-${id}`,
    mac: `00:00:00:00:00:${id.toString(16).padStart(2, '0')}`,
    ip: null,
    hostname: null,
    roomId: null,
    tagIds: [],
    enabled: true,
    status: 'offline',
    ...p,
  };
};
const req = (target: WakeTarget, onlyOffline = false) => ({ target, onlyOffline });
const ids = (r: { devices: DeviceSnap[] }) => r.devices.map((d) => d.id).sort((a, b) => a - b);
const NONE = new Map<number, number>();

describe('scope resolution (spec §4)', () => {
  const A1 = dev({ roomId: 1 });
  const A2 = dev({ roomId: 1, tagIds: [7] });
  const A3 = dev({ roomId: 1 });
  const B1 = dev({ roomId: 2, tagIds: [7] });
  const B2 = dev({ roomId: 2 });
  const loose = dev({ roomId: null, tagIds: [7] });
  const all = [A1, A2, A3, B1, B2, loose];

  it('AC-003-05 waking room A resolves exactly room A and nothing from room B', () => {
    const r = resolveWake(req({ type: 'rooms', roomIds: [1], includeNoRoom: false }), all, NONE);
    expect(ids(r)).toEqual([A1.id, A2.id, A3.id]);
    expect(r.devices.some((d) => d.roomId === 2)).toBe(false);
    expect(r.rooms).toEqual([{ roomId: 1, count: 3 }]);
  });

  it('AC-003-06 waking a tag resolves only tagged devices, across rooms', () => {
    const r = resolveWake(req({ type: 'tags', tagIds: [7] }), all, NONE);
    expect(ids(r)).toEqual([A2.id, B1.id, loose.id]);
  });

  it('AC-003-07 "só os desligados" leaves online devices out and reports them', () => {
    const room = [
      dev({ roomId: 9, status: 'online' }),
      dev({ roomId: 9, status: 'online' }),
      dev({ roomId: 9, status: 'offline' }),
    ];
    const r = resolveWake(
      req({ type: 'rooms', roomIds: [9], includeNoRoom: false }, true),
      room,
      NONE,
    );
    expect(ids(r)).toEqual([room[2]!.id]);
    expect(r.excluded.map((e) => e.reason)).toEqual(['online', 'online']);
  });

  it('SR-02 "Sem sala" only when asked; SR-05 all = every enabled device', () => {
    expect(
      ids(resolveWake(req({ type: 'rooms', roomIds: [], includeNoRoom: true }), all, NONE)),
    ).toEqual([loose.id]);
    expect(
      resolveWake(req({ type: 'rooms', roomIds: [1, 2], includeNoRoom: false }), all, NONE).devices,
    ).toHaveLength(5);
    const disabled = dev({ roomId: 1, enabled: false });
    const r = resolveWake(req({ type: 'all' }), [...all, disabled], NONE);
    expect(r.devices).toHaveLength(6);
    expect(r.excluded).toEqual([
      { deviceId: disabled.id, name: disabled.name, reason: 'disabled' },
    ]);
  });

  it('SR-04 selections report unknown ids and exclude disabled devices', () => {
    const disabled = dev({ enabled: false });
    const r = resolveWake(
      req({ type: 'devices', deviceIds: [A1.id, disabled.id, 9999, 9999] }),
      [...all, disabled],
      NONE,
    );
    expect(ids(r)).toEqual([A1.id]);
    expect(r.unknownIds).toEqual([9999]);
    expect(r.excluded[0]).toMatchObject({ deviceId: disabled.id, reason: 'disabled' });
  });

  it('AC-003-09 SR-11 devices already in an active job are excluded with the job id', () => {
    const r = resolveWake(
      req({ type: 'rooms', roomIds: [1], includeNoRoom: false }),
      all,
      new Map([[A2.id, 42]]),
    );
    expect(ids(r)).toEqual([A1.id, A3.id]);
    expect(r.excluded).toEqual([
      { deviceId: A2.id, name: A2.name, reason: 'in_active_job', jobId: 42 },
    ]);
  });

  it('SR-10 confirmation: above the threshold, more than one room ("Sem sala" counts) or "all"', () => {
    const one = resolveWake(req({ type: 'rooms', roomIds: [1], includeNoRoom: false }), all, NONE);
    expect(needsConfirmation({ type: 'rooms', roomIds: [1], includeNoRoom: false }, one, 40)).toBe(
      false,
    );
    expect(needsConfirmation({ type: 'rooms', roomIds: [1], includeNoRoom: false }, one, 2)).toBe(
      true,
    );
    const tag = resolveWake(req({ type: 'tags', tagIds: [7] }), all, NONE);
    expect(needsConfirmation({ type: 'tags', tagIds: [7] }, tag, 40)).toBe(true); // rooms 1, 2 and Sem sala
    const single = resolveWake(req({ type: 'devices', deviceIds: [A1.id] }), all, NONE);
    expect(needsConfirmation({ type: 'all' }, single, 40)).toBe(true);
  });

  it('the request schema defaults onlyOffline/includeNoRoom and rejects MAC lists', () => {
    expect(wakeRequestSchema.parse({ target: { type: 'rooms', roomIds: [1] } })).toEqual({
      target: { type: 'rooms', roomIds: [1], includeNoRoom: false },
      onlyOffline: false,
    });
    expect(
      wakeRequestSchema.safeParse({ target: { type: 'macs', macs: ['00:11:22:33:44:55'] } })
        .success,
    ).toBe(false);
    expect(
      wakeRequestSchema.safeParse({ target: { type: 'devices', deviceIds: [] } }).success,
    ).toBe(false);
  });
});

describe('scope resolution property (AC-003-18)', () => {
  const statusArb = fc.constantFrom<DeviceStatus>('online', 'offline', 'desconhecido');
  const snapArb = fc.array(
    fc.record({
      roomId: fc.option(fc.integer({ min: 1, max: 4 }), { nil: null }),
      tagIds: fc.uniqueArray(fc.integer({ min: 1, max: 4 }), { maxLength: 3 }),
      enabled: fc.boolean(),
      status: statusArb,
      active: fc.option(fc.integer({ min: 1, max: 3 }), { nil: null }),
    }),
    { maxLength: 40 },
  );
  const targetArb: fc.Arbitrary<WakeTarget> = fc.oneof(
    fc.record({
      type: fc.constant('rooms' as const),
      roomIds: fc.uniqueArray(fc.integer({ min: 1, max: 5 })),
      includeNoRoom: fc.boolean(),
    }),
    fc.record({
      type: fc.constant('tags' as const),
      tagIds: fc.uniqueArray(fc.integer({ min: 1, max: 5 }), { minLength: 1 }),
    }),
    fc.record({
      type: fc.constant('devices' as const),
      deviceIds: fc.uniqueArray(fc.integer({ min: 1, max: 45 }), { minLength: 1 }),
    }),
    fc.constant({ type: 'all' as const }),
  );

  /** Independent oracle written from the spec text, not from the implementation. */
  function inScope(t: WakeTarget, d: DeviceSnap): boolean {
    if (t.type === 'all') return true;
    if (t.type === 'devices') return t.deviceIds.includes(d.id);
    if (t.type === 'tags') return d.tagIds.some((x) => t.tagIds.includes(x));
    return d.roomId === null ? t.includeNoRoom : t.roomIds.includes(d.roomId);
  }

  it('resolved = in scope ∩ enabled ∩ (not online if onlyOffline) ∩ not in an active job; nothing else', () => {
    fc.assert(
      fc.property(snapArb, targetArb, fc.boolean(), (rows, target, onlyOffline) => {
        const snapshot = rows.map((r, i) => ({ ...dev(r), id: i + 1 }));
        const active = new Map<number, number>();
        rows.forEach((r, i) => {
          if (r.active !== null) active.set(i + 1, r.active);
        });
        const res = resolveWake({ target, onlyOffline }, snapshot, active);
        const expected = snapshot
          .filter(
            (d) =>
              inScope(target, d) &&
              d.enabled &&
              !(onlyOffline && d.status === 'online') &&
              !active.has(d.id),
          )
          .map((d) => d.id);
        expect(res.devices.map((d) => d.id)).toEqual(expected);
        // no device outside the target is ever woken or reported
        for (const d of res.devices) expect(inScope(target, d)).toBe(true);
        for (const e of res.excluded)
          expect(
            inScope(
              target,
              snapshot.find((d) => d.id === e.deviceId)!,
            ),
          ).toBe(true);
        // every in-scope device is either woken or excluded with a reason
        const inScopeCount = snapshot.filter((d) => inScope(target, d)).length;
        expect(res.devices.length + res.excluded.length).toBe(inScopeCount);
      }),
      { numRuns: 500 },
    );
  });
});
