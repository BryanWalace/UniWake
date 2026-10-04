/**
 * Dashboard and uptime (FR-004.5, FR-004.6). Past days come from `daily_uptime`, rolled up nightly
 * at 00:10 local (plan §5.2) with catch-up after downtime; today (and any day not rolled up yet)
 * is computed on demand from the status-event timeline.
 */
import type {
  Counters,
  Dashboard,
  DeviceHistoryItem,
  DeviceHistoryPage,
  DeviceHistoryQuery,
  DeviceResult,
  DashboardNotice,
  DashboardRoom,
  DashboardTag,
  DeviceStatus,
  RoomLastAction,
  StatusCounts,
  UptimeQuery,
  UptimeSeries,
} from '@uniwake/shared';
import { addDays, dayRange, localDay, nextLocalTime } from '../../domain/tz';
import { average, onlineMs, type StatusChange } from '../../domain/uptime';
import { AppError } from '../errors';
import type { Clock, Logger, TimerHandle } from '../ports';
import type { SettingsService } from '../settings/settings-service';

export interface RoomRow {
  id: number;
  name: string;
  code: string;
  block: string | null;
  floor: string | null;
  color: string;
}

/** A raw history row: a device event or one wake-job attempt. */
export interface HistoryRow {
  src: 'event' | 'wake';
  id: number;
  at: number;
  type: string;
  data: string;
  jobId: number | null;
  source: 'manual' | 'schedule' | 'test' | null;
  result: DeviceResult | null;
  dryRun: number | null;
  wokeAt: number | null;
}

export interface DashboardRepo {
  /** Per room (null = no room), with disabled devices counted as desconhecido. */
  statusCounts(): (StatusCounts & { roomId: number | null })[];
  rooms(): RoomRow[];
  lastActions(): Map<number, RoomLastAction>;
  tags(): DashboardTag[];
  openNotices(limit: number): DashboardNotice[];
  deviceExists(id: number): boolean;
  roomExists(id: number): boolean;
  /** Devices (id, created_at) currently in the room, or the single device. */
  devicesFor(q: { deviceId?: number; roomId?: number }): { id: number; createdAt: number }[];
  /** Every device created before `before`. */
  devicesCreatedBefore(before: number): { id: number; createdAt: number }[];
  /** Last status of each device strictly before `at` (devices without events are absent). */
  statusBefore(at: number, deviceIds?: readonly number[]): Map<number, DeviceStatus>;
  /** Status changes within `[from, to)`, grouped by device. */
  statusChanges(
    from: number,
    to: number,
    deviceIds?: readonly number[],
  ): Map<number, StatusChange[]>;
  dailyUptime(deviceIds: readonly number[], fromDay: string, toDay: string): Map<string, number>;
  upsertDailyUptime(rows: readonly { deviceId: number; day: string; onlineMs: number }[]): void;
  latestRolledDay(): string | null;
  /** Newest first: `at < before` (limited), or every row with `at = exactly`. */
  deviceHistory(
    deviceId: number,
    q: { before: number | null; limit: number } | { exactly: number },
  ): HistoryRow[];
  earliestDeviceCreatedAt(): number | null;
}

export interface DashboardDeps {
  repo: DashboardRepo;
  settings: SettingsService;
  clock: Clock;
  logger: Logger;
  transaction: <T>(fn: () => T) => T;
  demo: boolean;
  lastSweepAt: () => number | null;
}

const ROLLUP_AT = '00:10';
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
/** Natural order with empty values last. */
const cmp = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null || a === '' ? 1 : b === null || b === '' ? -1 : collator.compare(a, b);

function toHistoryItem(r: HistoryRow): DeviceHistoryItem {
  if (r.src === 'wake') {
    return {
      kind: 'wake',
      at: r.at,
      jobId: r.jobId!,
      source: r.source!,
      result: r.result!,
      dryRun: r.dryRun === 1,
      wokeAt: r.wokeAt,
    };
  }
  const data = JSON.parse(r.data) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  switch (r.type) {
    case 'status':
      return {
        kind: 'status',
        at: r.at,
        from: str(data.from) as DeviceStatus | null,
        to: (str(data.to) ?? 'desconhecido') as DeviceStatus,
        reason: str(data.reason),
      };
    case 'ip_changed':
      return { kind: 'ip_changed', at: r.at, from: str(data.from), to: str(data.to) ?? '' };
    default:
      return { kind: r.type === 'moved' ? 'moved' : 'enrolled', at: r.at, data };
  }
}

const empty = (): StatusCounts => ({ online: 0, offline: 0, desconhecido: 0, total: 0 });

export class DashboardService {
  private timer: TimerHandle | null = null;

  constructor(private readonly d: DashboardDeps) {}

  private get tz(): string {
    return this.d.settings.get('scheduler.timezone');
  }

  counters(): Counters {
    const rooms = this.d.repo.statusCounts();
    const global = empty();
    for (const r of rooms) {
      global.online += r.online;
      global.offline += r.offline;
      global.desconhecido += r.desconhecido;
      global.total += r.total;
    }
    return { global, rooms };
  }

  dashboard(): Dashboard {
    const { global, rooms: counts } = this.counters();
    const byRoom = new Map(counts.map((c) => [c.roomId, c]));
    const last = this.d.repo.lastActions();
    const rooms: DashboardRoom[] = this.d.repo
      .rooms()
      .sort((a, b) => cmp(a.block, b.block) || cmp(a.floor, b.floor) || cmp(a.name, b.name))
      .map((r) => {
        const c = byRoom.get(r.id);
        return {
          ...r,
          counts: c
            ? { online: c.online, offline: c.offline, desconhecido: c.desconhecido, total: c.total }
            : empty(),
          lastAction: last.get(r.id) ?? null,
        };
      });
    const none = byRoom.get(null);
    return {
      counters: global,
      rooms,
      noRoom:
        none && none.total > 0
          ? {
              online: none.online,
              offline: none.offline,
              desconhecido: none.desconhecido,
              total: none.total,
            }
          : null,
      tags: this.d.repo.tags(),
      notices: this.d.repo.openNotices(20),
      demo: this.d.demo,
      lastSweepAt: this.d.lastSweepAt(),
    };
  }

  /** Daily uptime for one device or a room (average of its devices, AC-004-16). */
  uptime(q: UptimeQuery): UptimeSeries {
    if (q.deviceId !== undefined && !this.d.repo.deviceExists(q.deviceId)) {
      throw new AppError('DEVICE_NOT_FOUND');
    }
    if (q.roomId !== undefined && !this.d.repo.roomExists(q.roomId)) {
      throw new AppError('NOT_FOUND');
    }
    const tz = this.tz;
    const now = this.d.clock.now();
    const today = localDay(now, tz);
    const first = addDays(today, -(q.days - 1));
    const devices = this.d.repo.devicesFor(q);
    const ids = devices.map((x) => x.id);
    const stored = this.d.repo.dailyUptime(ids, first, today);

    const days: UptimeSeries['days'] = [];
    for (let day = first; day <= today; day = addDays(day, 1)) {
      const { start, end: dayEnd } = dayRange(day, tz);
      const end = Math.min(dayEnd, now);
      const alive = devices.filter((x) => x.createdAt < end);
      const missing = alive.filter((x) => day === today || !stored.has(`${x.id}|${day}`));
      const live =
        missing.length > 0
          ? this.computeDay(
              start,
              end,
              missing.map((x) => x.id),
            )
          : null;
      const ratios = alive.map((x) => {
        const ms = live?.get(x.id) ?? stored.get(`${x.id}|${day}`) ?? 0;
        return end > start ? ms / (end - start) : null;
      });
      days.push({ day, ratio: alive.length === 0 ? null : average(ratios) });
    }
    return { days, average: average(days.map((x) => x.ratio)) };
  }

  /** Status changes, IP drift, moves and wake attempts of one device (FR-004.6). */
  history(deviceId: number, q: DeviceHistoryQuery): DeviceHistoryPage {
    if (!this.d.repo.deviceExists(deviceId)) throw new AppError('DEVICE_NOT_FOUND');
    let rows = this.d.repo.deviceHistory(deviceId, { before: q.before ?? null, limit: q.limit });
    let nextBefore: number | null = null;
    if (rows.length === q.limit) {
      // Never split rows sharing the boundary instant: the next page starts strictly before it.
      const last = rows[rows.length - 1]!.at;
      const seen = new Set(rows.map((r) => `${r.src}:${r.id}`));
      rows = [
        ...rows,
        ...this.d.repo
          .deviceHistory(deviceId, { exactly: last })
          .filter((r) => !seen.has(`${r.src}:${r.id}`)),
      ];
      nextBefore = last;
    }
    return { items: rows.map(toHistoryItem), nextBefore };
  }

  private computeDay(start: number, end: number, ids: readonly number[]): Map<number, number> {
    const initial = this.d.repo.statusBefore(start, ids);
    const changes = this.d.repo.statusChanges(start, end, ids);
    return new Map(
      ids.map((id) => [
        id,
        onlineMs(initial.get(id) ?? 'desconhecido', changes.get(id) ?? [], start, end),
      ]),
    );
  }

  /** Writes `daily_uptime` for one finished local day. */
  rollupDay(day: string): number {
    const { start, end } = dayRange(day, this.tz);
    const ids = this.d.repo.devicesCreatedBefore(end).map((x) => x.id);
    const ms = this.computeDay(start, end, ids);
    this.d.transaction(() =>
      this.d.repo.upsertDailyUptime(
        ids.map((id) => ({ deviceId: id, day, onlineMs: ms.get(id)! })),
      ),
    );
    return ids.length;
  }

  /** Rolls up every finished day not yet rolled up (bounded by history retention). */
  rollupPending(): string[] {
    const tz = this.tz;
    const yesterday = addDays(localDay(this.d.clock.now(), tz), -1);
    const oldest = addDays(yesterday, -(this.d.settings.get('retention.historyDays') - 1));
    const last = this.d.repo.latestRolledDay();
    const createdAt = this.d.repo.earliestDeviceCreatedAt();
    if (createdAt === null) return [];
    let day = last ? addDays(last, 1) : localDay(createdAt, tz);
    if (day < oldest) day = oldest;
    const done: string[] = [];
    for (; day <= yesterday; day = addDays(day, 1)) {
      this.rollupDay(day);
      done.push(day);
    }
    return done;
  }

  /** Catch up now, then every night at 00:10 local. */
  start(): void {
    this.runRollup();
  }

  stop(): void {
    if (this.timer !== null) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private runRollup() {
    try {
      const days = this.rollupPending();
      if (days.length > 0) this.d.logger.info({ days }, 'daily uptime rolled up');
    } catch (e) {
      this.d.logger.error({ err: e }, 'daily uptime rollup failed');
    }
    const now = this.d.clock.now();
    this.timer = this.d.clock.setTimeout(
      () => this.runRollup(),
      nextLocalTime(now, ROLLUP_AT, this.tz) - now,
    );
  }
}
