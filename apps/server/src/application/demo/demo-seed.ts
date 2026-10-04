/**
 * Demo seed (FR-015): 4 rooms, 60 devices, tags, 7 days of status history and a past morning
 * wake result, written on the first start of `--demo` with an empty inventory. Device power in the
 * simulated network is aligned with the history's last state.
 */
import { addDays, dayStart, localDay } from '../../domain/tz';
import type { Actor } from '../audit/audit-service';
import type { DevicesService } from '../devices/devices-service';
import type { DeviceEvent, MonitorRepo, StatusUpdate } from '../monitor/monitor-service';
import type { Clock } from '../ports';
import type { RoomsService } from '../rooms/rooms-service';
import type { SettingsService } from '../settings/settings-service';
import type { TagsService } from '../tags/tags-service';
import { summarize, type JobsRepo } from '../wake/types';

export interface DemoRepo {
  /** Seed only an empty inventory (no rooms, no devices). */
  isEmpty(): boolean;
  /** The history predates the seed, so the inventory must too. */
  backdateInventory(at: number): void;
}

export interface DemoSeedDeps {
  rooms: RoomsService;
  tags: TagsService;
  devices: DevicesService;
  jobs: JobsRepo;
  monitor: Pick<MonitorRepo, 'insertEvents' | 'saveStates'>;
  settings: SettingsService;
  clock: Clock;
  transaction: <T>(fn: () => T) => T;
  random?: () => number;
  /** Simulated network hooks: power state and which machines never wake. */
  setPower: (mac: string, on: boolean) => void;
  neverWakes: (mac: string) => boolean;
  demo: DemoRepo;
}

const ACTOR: Actor = { id: null, label: 'demonstração' };
const H = 3_600_000;
const M = 60_000;

const ROOMS = [
  {
    name: 'Laboratório 1',
    code: 'LAB1',
    block: 'Bloco A',
    floor: '1º andar',
    color: '#2563eb',
    n: 18,
  },
  {
    name: 'Laboratório 2',
    code: 'LAB2',
    block: 'Bloco A',
    floor: '2º andar',
    color: '#16a34a',
    n: 16,
  },
  {
    name: 'Laboratório 3',
    code: 'LAB3',
    block: 'Bloco B',
    floor: 'Térreo',
    color: '#d97706',
    n: 14,
  },
  { name: 'Biblioteca', code: 'BIB', block: 'Bloco C', floor: 'Térreo', color: '#9333ea', n: 10 },
] as const;

const TAGS = [
  { name: 'Mesa do professor', color: '#dc2626' },
  { name: 'Projetor', color: '#0891b2' },
  { name: 'Windows 11', color: '#4f46e5' },
] as const;

export interface DemoSeedResult {
  rooms: number;
  devices: number;
  events: number;
}

export function seedDemo(d: DemoSeedDeps): DemoSeedResult | null {
  if (!d.demo.isEmpty()) return null;
  const random = d.random ?? Math.random;
  const tz = d.settings.get('scheduler.timezone');
  const now = d.clock.now();
  const today = localDay(now, tz);

  return d.transaction(() => {
    const tagIds = TAGS.map((t) => d.tags.create(t, ACTOR).id);
    const devices: { id: number; mac: string; roomId: number | null }[] = [];
    const mk = (roomId: number | null, prefix: string, subnet: number, n: number) => {
      const mac =
        `3C:52:82:${subnet.toString(16).padStart(2, '0')}:00:${n.toString(16).padStart(2, '0')}`.toUpperCase();
      const name = `${prefix}-PC${String(n).padStart(2, '0')}`;
      const tags = [
        ...(n === 1 ? [tagIds[0]!, tagIds[1]!] : []),
        ...(n % 3 === 0 ? [tagIds[2]!] : []),
      ];
      const created = d.devices.create(
        {
          name,
          mac,
          roomId,
          ip: `10.20.${subnet}.${n + 10}`,
          hostname: name.toLowerCase(),
          tagIds: tags,
        },
        ACTOR,
      );
      devices.push({ id: created.device.id, mac, roomId });
    };
    ROOMS.forEach((r, ri) => {
      const roomId = d.rooms.create(
        { name: r.name, code: r.code, block: r.block, floor: r.floor, color: r.color },
        ACTOR,
      ).id;
      for (let n = 1; n <= r.n; n++) mk(roomId, r.code, ri + 1, n);
    });
    mk(null, 'NOTE', 9, 1);
    mk(null, 'NOTE', 9, 2);
    d.demo.backdateInventory(dayStart(addDays(today, -8), tz));

    // Seven days of history: weekdays on from ~07:00 to ~22:00, weekends mostly off.
    const events: DeviceEvent[] = [];
    const states: StatusUpdate[] = [];
    for (const dev of devices) {
      const never = d.neverWakes(dev.mac);
      let on = false;
      let lastSeen: number | null = null;
      for (let k = 7; k >= 0; k--) {
        const day = addDays(today, -k);
        const start = dayStart(day, tz);
        const weekday = new Date(start + 12 * H).getUTCDay();
        const working = weekday >= 1 && weekday <= 5;
        if (never || random() > (working ? 0.9 : 0.15)) continue;
        const up = start + 7 * H + Math.round(random() * 60) * M - 30 * M;
        const down = start + (working ? 22 : 12) * H + Math.round(random() * 90) * M - 45 * M;
        for (const [at, to] of [
          [up, 'online'],
          [down, 'offline'],
        ] as const) {
          if (at > now) break;
          events.push({ deviceId: dev.id, at, type: 'status', data: { to, reason: 'demo' } });
          on = to === 'online';
          lastSeen = at; // seen until it shut down
        }
      }
      d.setPower(dev.mac, on);
      states.push({
        deviceId: dev.id,
        state: {
          status: 'desconhecido',
          latencyMs: null,
          lastSeenAt: lastSeen,
          onlineSince: null,
          lastProbeAt: lastSeen,
          consecutiveFailures: 0,
          everOnline: lastSeen !== null,
        },
      });
    }
    d.monitor.insertEvents(events);
    d.monitor.saveStates(states);

    // Yesterday's (or the last weekday's) 06:50 wake, as a schedule would have done it.
    let day = addDays(today, -1);
    while ([0, 6].includes(new Date(dayStart(day, tz) + 12 * H).getUTCDay()))
      day = addDays(day, -1);
    const at = dayStart(day, tz) + 6 * H + 50 * M;
    const inRooms = devices.filter((x) => x.roomId !== null);
    const jobId = d.jobs.create({
      source: 'schedule',
      scheduleRunId: null,
      requestedBy: null,
      target: { type: 'all' },
      targetLabel: 'Todas as máquinas',
      onlyOffline: false,
      dryRun: true,
      stagger: null,
      createdAt: at,
      devices: inRooms.map((x) => ({
        deviceId: x.id,
        mac: x.mac,
        roomId: x.roomId,
        result: 'aguardando',
      })),
      excludedCount: 0,
    });
    d.jobs.markSent(
      jobId,
      inRooms.map((x) => x.id),
      at + 5_000,
    );
    const results = inRooms.map((x) => ({
      deviceId: x.id,
      result: d.neverWakes(x.mac) ? ('nao_respondeu' as const) : ('acordou' as const),
      at: at + 40_000 + Math.round(random() * 80_000),
    }));
    d.jobs.setDeviceResults(
      jobId,
      results.map((r) => (r.result === 'acordou' ? r : { deviceId: r.deviceId, result: r.result })),
    );
    d.jobs.setState(jobId, 'concluido', {
      startedAt: at,
      finishedAt: at + 5 * M,
      verifyUntil: null,
    });
    d.jobs.setSummary(
      jobId,
      summarize(
        results.map((r) => r.result),
        0,
      ),
    );
    return { rooms: ROOMS.length, devices: devices.length, events: events.length };
  });
}
