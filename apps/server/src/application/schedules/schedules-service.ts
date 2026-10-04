/**
 * Schedules (FR-005.1, FR-005.8). A schedule stores a wake target as rows (room/tag/device/all/
 * "Sem sala"); refs that disappear later (room deleted) just shrink the target, which may become
 * "alvo vazio". Large targets are confirmed once, when saved (SR-10).
 */
import {
  type NextRun,
  type Schedule,
  type ScheduleCreate,
  scheduleCreateSchema,
  type ScheduleUpdate,
  scheduleUpdateSchema,
  type WakeTarget,
} from '@uniwake/shared';
import {
  exceptionFor,
  type ExceptionRange,
  nextOccurrences,
  type ScheduleRule,
} from '../../domain/schedule';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import type { TargetSummary } from '../wake/wake-service';

export type TargetRowType = 'room' | 'tag' | 'device' | 'all' | 'no_room';
export interface TargetRow {
  type: TargetRowType;
  refId: number | null;
}

export interface ScheduleRecord {
  id: number;
  name: string;
  enabled: boolean;
  weekdays: number;
  timeLocal: string;
  timezone: string;
  onlyOffline: boolean;
  batchSize: number | null;
  batchDelayMs: number | null;
  confirmedCount: number | null;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
  targets: TargetRow[];
}

export type ScheduleWrite = Omit<ScheduleRecord, 'id' | 'createdAt' | 'createdBy'>;

export interface SchedulesRepo {
  list(): ScheduleRecord[];
  get(id: number): ScheduleRecord | undefined;
  insert(s: ScheduleWrite, createdBy: number | null, now: number): number;
  update(id: number, s: ScheduleWrite, now: number): void;
  delete(id: number): void;
  exceptions(): ExceptionRange[];
}

export interface TargetRefs {
  room: (id: number) => boolean;
  tag: (id: number) => boolean;
  device: (id: number) => boolean;
}

export interface SchedulesDeps {
  repo: SchedulesRepo;
  refs: TargetRefs;
  describeTargets: (targets: readonly WakeTarget[]) => TargetSummary[];
  settings: SettingsService;
  audit: AuditService;
  clock: Clock;
  transaction: <T>(fn: () => T) => T;
}

export function targetToRows(t: WakeTarget): TargetRow[] {
  switch (t.type) {
    case 'all':
      return [{ type: 'all', refId: null }];
    case 'rooms':
      return [
        ...t.roomIds.map((id) => ({ type: 'room' as const, refId: id })),
        ...(t.includeNoRoom ? [{ type: 'no_room' as const, refId: null }] : []),
      ];
    case 'tags':
      return t.tagIds.map((id) => ({ type: 'tag' as const, refId: id }));
    case 'devices':
      return t.deviceIds.map((id) => ({ type: 'device' as const, refId: id }));
  }
}

/** Rows back to a target; refs that no longer exist are dropped (the target shrinks). */
export function rowsToTarget(rows: readonly TargetRow[], refs: TargetRefs): WakeTarget {
  const ids = (type: TargetRowType, exists: (id: number) => boolean) =>
    rows.filter((r) => r.type === type && r.refId !== null && exists(r.refId)).map((r) => r.refId!);
  if (rows.some((r) => r.type === 'all')) return { type: 'all' };
  if (rows.some((r) => r.type === 'tag')) return { type: 'tags', tagIds: ids('tag', refs.tag) };
  if (rows.some((r) => r.type === 'device')) {
    return { type: 'devices', deviceIds: ids('device', refs.device) };
  }
  return {
    type: 'rooms',
    roomIds: ids('room', refs.room),
    includeNoRoom: rows.some((r) => r.type === 'no_room'),
  };
}

export class SchedulesService {
  constructor(private readonly d: SchedulesDeps) {}

  list(): Schedule[] {
    const records = this.d.repo.list();
    const exceptions = this.d.repo.exceptions();
    const targets = records.map((r) => rowsToTarget(r.targets, this.d.refs));
    const summaries = this.d.describeTargets(targets);
    return records.map((r, i) => this.view(r, targets[i]!, summaries[i]!, exceptions));
  }

  get(id: number): Schedule {
    const r = this.record(id);
    const target = rowsToTarget(r.targets, this.d.refs);
    return this.view(r, target, this.d.describeTargets([target])[0]!, this.d.repo.exceptions());
  }

  /** The next runs, skipping exception days (AC-005-01). */
  nextRuns(id: number, count = 5): NextRun[] {
    const r = this.record(id);
    const exceptions = this.d.repo.exceptions();
    return nextOccurrences(rule(r), this.d.clock.now(), count, (day) =>
      Boolean(exceptionFor(day, exceptions, r.id)),
    );
  }

  /** The stored target as it resolves today (the scheduler runs this). */
  target(id: number): { record: ScheduleRecord; target: WakeTarget } {
    const record = this.record(id);
    return { record, target: rowsToTarget(record.targets, this.d.refs) };
  }

  create(input: ScheduleCreate, actor: Actor): Schedule {
    const id = this.d.transaction(() => {
      const data = scheduleCreateSchema.parse(input);
      this.assertRefsExist(data.target);
      const confirmedCount = this.confirmIfLarge(data.target, data.confirm?.count);
      const now = this.d.clock.now();
      const id = this.d.repo.insert(
        {
          name: data.name,
          enabled: data.enabled,
          weekdays: data.weekdays,
          timeLocal: data.timeLocal,
          timezone: data.timezone ?? this.d.settings.get('scheduler.timezone'),
          onlyOffline: data.onlyOffline,
          batchSize: data.stagger?.batchSize ?? null,
          batchDelayMs: data.stagger ? data.stagger.batchDelaySeconds * 1000 : null,
          confirmedCount,
          updatedAt: now,
          targets: targetToRows(data.target),
        },
        actor.id,
        now,
      );
      this.d.audit.record({
        actor,
        action: 'schedule.create',
        target: `schedule:${data.name}`,
        details: { id, weekdays: data.weekdays, timeLocal: data.timeLocal },
      });
      return id;
    });
    return this.get(id);
  }

  update(id: number, input: ScheduleUpdate, actor: Actor): Schedule {
    this.d.transaction(() => {
      const patch = scheduleUpdateSchema.parse(input);
      const current = this.record(id);
      let targets = current.targets;
      let confirmedCount = current.confirmedCount;
      if (patch.target) {
        this.assertRefsExist(patch.target);
        confirmedCount = this.confirmIfLarge(patch.target, patch.confirm?.count);
        targets = targetToRows(patch.target);
      }
      const stagger =
        patch.stagger === undefined
          ? { batchSize: current.batchSize, batchDelayMs: current.batchDelayMs }
          : {
              batchSize: patch.stagger?.batchSize ?? null,
              batchDelayMs: patch.stagger ? patch.stagger.batchDelaySeconds * 1000 : null,
            };
      this.d.repo.update(
        id,
        {
          name: patch.name ?? current.name,
          enabled: patch.enabled ?? current.enabled,
          weekdays: patch.weekdays ?? current.weekdays,
          timeLocal: patch.timeLocal ?? current.timeLocal,
          timezone: patch.timezone ?? current.timezone,
          onlyOffline: patch.onlyOffline ?? current.onlyOffline,
          ...stagger,
          confirmedCount,
          updatedAt: this.d.clock.now(),
          targets,
        },
        this.d.clock.now(),
      );
      this.d.audit.record({
        actor,
        action: 'schedule.update',
        target: `schedule:${patch.name ?? current.name}`,
        details: { id, fields: Object.keys(patch).filter((k) => k !== 'confirm') },
      });
    });
    return this.get(id);
  }

  delete(id: number, actor: Actor): void {
    this.d.transaction(() => {
      const current = this.record(id);
      this.d.repo.delete(id);
      this.d.audit.record({
        actor,
        action: 'schedule.delete',
        target: `schedule:${current.name}`,
        details: { id },
      });
    });
  }

  private record(id: number): ScheduleRecord {
    const r = this.d.repo.get(id);
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  private assertRefsExist(t: WakeTarget) {
    const missing =
      (t.type === 'rooms' && t.roomIds.some((id) => !this.d.refs.room(id))) ||
      (t.type === 'tags' && t.tagIds.some((id) => !this.d.refs.tag(id))) ||
      (t.type === 'devices' && t.deviceIds.some((id) => !this.d.refs.device(id)));
    if (missing) throw new AppError('TARGET_NOT_FOUND');
  }

  /** SR-10 at save time: returns the confirmed count to store (null when not needed). */
  private confirmIfLarge(target: WakeTarget, confirmed: number | undefined): number | null {
    const s = this.d.describeTargets([target])[0]!;
    if (!s.needsConfirmation) return null;
    if (confirmed !== s.count) {
      throw new AppError(
        'CONFIRMATION_REQUIRED',
        { count: s.count },
        { count: s.count, rooms: s.rooms },
      );
    }
    return s.count;
  }

  private view(
    r: ScheduleRecord,
    target: WakeTarget,
    summary: TargetSummary,
    exceptions: readonly ExceptionRange[],
  ): Schedule {
    const next = r.enabled
      ? nextOccurrences(rule(r), this.d.clock.now(), 1, (day) =>
          Boolean(exceptionFor(day, exceptions, r.id)),
        )[0]
      : undefined;
    return {
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      weekdays: r.weekdays,
      timeLocal: r.timeLocal,
      timezone: r.timezone,
      target,
      targetLabel: summary.label,
      onlyOffline: r.onlyOffline,
      stagger:
        r.batchSize !== null && r.batchDelayMs !== null
          ? { batchSize: r.batchSize, batchDelaySeconds: Math.round(r.batchDelayMs / 1000) }
          : null,
      confirmedCount: r.confirmedCount,
      targetCount: summary.count,
      emptyTarget: summary.empty,
      nextRun: next?.at ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

export function rule(r: Pick<ScheduleRecord, 'weekdays' | 'timeLocal' | 'timezone'>): ScheduleRule {
  return { weekdays: r.weekdays, timeLocal: r.timeLocal, timezone: r.timezone };
}
