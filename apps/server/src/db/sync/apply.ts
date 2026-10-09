/**
 * Applies changes pulled from a peer (FR-202.3, FR-203, ADR-040, plan §14.4). One transaction per
 * batch, in dependency order; versions compare by (rev, instance id); applying a batch twice changes
 * nothing. A winning remote version keeps its revision and instance in our log, so it gossips on
 * unchanged. Whatever this PC has to change while applying (a duplicate renamed, an orphan dropped,
 * a device that lost its room) is a new local write and propagates back.
 */
import { isSettingKey, SETTING_DEFS } from '@uniwake/shared';
import type { Db } from '../connection';
import { changeLog } from './change-log';
import {
  BASELINE_ORDER,
  type EntityName,
  PAUSE_ID,
  PAUSE_KEY,
  pauseSnapshot,
  type RowEntity,
  rowSnapshot,
  settingSnapshot,
  TABLE,
  TOUCH_SETS_UPDATED_AT,
} from './entities';

export interface ChangeEntry {
  seq: number;
  entity: EntityName;
  entityId: string;
  op: 'upsert' | 'delete';
  rev: number;
  instance: string;
  at: number;
  payload: Record<string, unknown> | null;
}

export type ConflictKind = 'concurrent' | 'duplicate_mac' | 'duplicate_name';

export interface ConflictRecord {
  entity: EntityName;
  entityId: string;
  label: string;
  kind: ConflictKind;
  kept: unknown;
  discarded: unknown;
  winnerInstance: string | null;
}

export interface ApplyOptions {
  now: number;
  /** The peer's cursor into our log: our versions after it were unseen by them (concurrency). */
  peerAckedSeq?: number;
  /** The peer the batch came from (its own earlier versions are never a conflict). */
  peerInstance?: string;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  conflicts: ConflictRecord[];
  /** Entity kinds that changed (the hub reloads settings, refreshes panels). */
  touched: Set<EntityName>;
}

const ORDER: readonly EntityName[] = [...BASELINE_ORDER, 'setting', 'scheduler_pause'];
const orderOf = (e: EntityName) => {
  const i = ORDER.indexOf(e);
  return i < 0 ? ORDER.length : i;
};

interface LogRow {
  seq: number;
  op: string;
  rev: number;
  instance_id: string;
  payload: string | null;
}

const cmpVersion = (a: { rev: number; instance: string }, b: { rev: number; instance: string }) =>
  a.rev - b.rev || (a.instance < b.instance ? -1 : a.instance > b.instance ? 1 : 0);

const isRow = (e: EntityName): e is RowEntity => e in TABLE;

/** The local id of a replicated row, or null. */
function localId(db: Db, entity: RowEntity, uuid: string | null | undefined): number | null {
  if (!uuid) return null;
  return (
    db.get<{ id: number }>(`SELECT id FROM ${TABLE[entity]} WHERE uuid = ?`, [uuid])?.id ?? null
  );
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const bool = (v: unknown) => (v === true ? 1 : 0);
const jsonText = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

export class RemoteApplier {
  private readonly conflicts: ConflictRecord[] = [];
  private readonly touched = new Set<EntityName>();
  /** Devices whose room or tags a delete may have changed: re-checked after the batch. */
  private readonly maybeChanged = new Set<number>();

  constructor(
    private readonly db: Db,
    private readonly opts: ApplyOptions,
  ) {}

  private get log() {
    return changeLog(this.db);
  }

  run(entries: readonly ChangeEntry[]): ApplyResult {
    let applied = 0;
    let skipped = 0;
    this.db.transaction(() => {
      const maxRev = entries.reduce((m, e) => Math.max(m, e.rev), 0);
      this.log.instanceId(); // ensures the instance row before merging the clock
      this.db.run('UPDATE instance SET clock = MAX(clock, ?) WHERE id = 1', [maxRev]);
      const sorted = entries
        .map((e, i) => ({ e, i }))
        .sort((a, b) => orderOf(a.e.entity) - orderOf(b.e.entity) || a.i - b.i)
        .map((x) => x.e);
      for (const e of sorted) {
        if (this.applyOne(e)) applied++;
        else skipped++;
      }
      for (const id of this.maybeChanged) this.relogIfChanged('device', id);
    });
    return { applied, skipped, conflicts: this.conflicts, touched: this.touched };
  }

  private relogIfChanged(entity: RowEntity, id: number) {
    const uuid = this.db.get<{ uuid: string | null }>(
      `SELECT uuid FROM ${TABLE[entity]} WHERE id = ?`,
      [id],
    )?.uuid;
    if (!uuid) return;
    const logged = this.db.get<{ payload: string | null }>(
      'SELECT payload FROM change_log WHERE entity = ? AND entity_id = ?',
      [entity, uuid],
    )?.payload;
    if (logged !== JSON.stringify(rowSnapshot(this.db, entity, id))) this.log.touch(entity, id);
  }

  private applyOne(e: ChangeEntry): boolean {
    if (
      e.entity === 'setting' &&
      !(isSettingKey(e.entityId) && SETTING_DEFS[e.entityId].meta.scope === 'shared')
    ) {
      return false; // FR-202.4: machine settings never apply, even if a peer sent one
    }
    const local = this.db.get<LogRow>(
      'SELECT seq, op, rev, instance_id, payload FROM change_log WHERE entity = ? AND entity_id = ?',
      [e.entity, e.entityId],
    );
    const incoming = { rev: e.rev, instance: e.instance };
    const incomingPayload = e.payload === null ? null : JSON.stringify(e.payload);
    if (local) {
      const l = { rev: local.rev, instance: local.instance_id };
      const c = cmpVersion(l, incoming);
      if (c === 0) return false; // the same version (an echo of what we sent, or seen via another PC)
      const concurrent =
        local.seq > (this.opts.peerAckedSeq ?? Number.MAX_SAFE_INTEGER) &&
        local.instance_id !== this.opts.peerInstance &&
        local.payload !== incomingPayload;
      if (c > 0) {
        if (concurrent)
          this.conflict(e, 'concurrent', parse(local.payload), e.payload, local.instance_id);
        return false;
      }
      if (concurrent) this.conflict(e, 'concurrent', e.payload, parse(local.payload), e.instance);
    }
    if (e.op === 'delete') this.applyDelete(e);
    else this.applyUpsert(e);
    this.touched.add(e.entity);
    return true;
  }

  private conflict(
    e: ChangeEntry,
    kind: ConflictKind,
    kept: unknown,
    discarded: unknown,
    winner: string | null,
  ) {
    this.conflicts.push({
      entity: e.entity,
      entityId: e.entityId,
      label: labelOf(e.entity, kept ?? discarded),
      kind,
      kept,
      discarded,
      winnerInstance: winner,
    });
  }

  /** Writes the log row with the remote version (the row itself is already written). */
  private writeLog(e: ChangeEntry, payload: Record<string, unknown> | null) {
    this.db.run('DELETE FROM change_log WHERE entity = ? AND entity_id = ?', [
      e.entity,
      e.entityId,
    ]);
    this.db.run(
      `INSERT INTO change_log (entity, entity_id, op, rev, instance_id, at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        e.entity,
        e.entityId,
        e.op,
        e.rev,
        e.instance,
        e.at,
        payload === null ? null : JSON.stringify(payload),
      ],
    );
  }

  private stamp(entity: RowEntity, id: number, e: ChangeEntry) {
    const setUpdatedAt =
      TOUCH_SETS_UPDATED_AT.has(entity) || ['room', 'device', 'schedule'].includes(entity);
    this.db.run(
      `UPDATE ${TABLE[entity]} SET uuid = ?, rev = ?, updated_by_instance = ?${setUpdatedAt ? ', updated_at = ?' : ''} WHERE id = ?`,
      setUpdatedAt
        ? [e.entityId, e.rev, e.instance, e.at, id]
        : [e.entityId, e.rev, e.instance, id],
    );
  }

  // ------------------------------------------------------------------ deletes
  private applyDelete(e: ChangeEntry) {
    if (isRow(e.entity)) {
      const id = localId(this.db, e.entity, e.entityId);
      if (id !== null) this.deleteRow(e.entity, id);
    } else if (e.entity === 'setting') {
      this.db.run('DELETE FROM settings WHERE key = ?', [e.entityId]);
    }
    this.writeLog(e, null); // remember the delete even without a local row (no resurrection)
  }

  /** Same cascade semantics as the repositories' deletes (ADR-031 §5/§8). */
  private deleteRow(entity: RowEntity, id: number) {
    const db = this.db;
    switch (entity) {
      case 'room':
        for (const d of db.all<{ id: number }>('SELECT id FROM devices WHERE room_id = ?', [id]))
          this.maybeChanged.add(d.id);
        db.run("UPDATE schedule_targets SET ref_id = NULL WHERE type = 'room' AND ref_id = ?", [
          id,
        ]);
        break;
      case 'tag':
        for (const d of db.all<{ id: number }>(
          'SELECT device_id AS id FROM device_tags WHERE tag_id = ?',
          [id],
        ))
          this.maybeChanged.add(d.id);
        db.run("UPDATE schedule_targets SET ref_id = NULL WHERE type = 'tag' AND ref_id = ?", [id]);
        break;
      case 'device':
        db.run("UPDATE schedule_targets SET ref_id = NULL WHERE type = 'device' AND ref_id = ?", [
          id,
        ]);
        this.maybeChanged.delete(id);
        break;
      case 'schedule': {
        const ids = (sql: string) => db.all<{ id: number }>(sql, [id]).map((r) => r.id);
        this.log.tombstone(
          'schedule_exception',
          ids('SELECT id FROM schedule_exceptions WHERE schedule_id = ?'),
        );
        this.log.tombstone(
          'schedule_run',
          ids('SELECT id FROM schedule_runs WHERE schedule_id = ?'),
        );
        break;
      }
      default:
        break;
    }
    db.run(`DELETE FROM ${TABLE[entity]} WHERE id = ?`, [id]);
  }

  // ------------------------------------------------------------------ upserts
  private applyUpsert(e: ChangeEntry) {
    const p = e.payload ?? {};
    if (e.entity === 'setting') {
      this.db.run(
        `INSERT INTO settings (key, value, updated_at, updated_by, rev, updated_by_instance) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
           updated_by = excluded.updated_by, rev = excluded.rev, updated_by_instance = excluded.updated_by_instance`,
        [
          e.entityId,
          JSON.stringify(p.value ?? null),
          e.at,
          localId(this.db, 'user', str(p.updatedBy)),
          e.rev,
          e.instance,
        ],
      );
      this.finishKeyed(e, settingSnapshot(this.db, e.entityId)!);
      return;
    }
    if (e.entity === 'scheduler_pause') {
      if (p.pause === null || p.pause === undefined)
        this.db.run('DELETE FROM system_state WHERE key = ?', [PAUSE_KEY]);
      else {
        this.db.run(
          'INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [PAUSE_KEY, JSON.stringify(p.pause)],
        );
      }
      this.finishKeyed(e, pauseSnapshot(this.db));
      return;
    }
    const entity = e.entity;
    const id = this.upsertRow(entity, e, p);
    if (id === null) return;
    this.stamp(entity, id, e);
    const snap = rowSnapshot(this.db, entity, id)!;
    if (JSON.stringify(snap) === JSON.stringify(e.payload)) this.writeLog(e, snap);
    // What we stored differs (a reference we do not have, a renamed duplicate): our own new version.
    else this.log.touch(entity, id);
  }

  private finishKeyed(e: ChangeEntry, snap: Record<string, unknown>) {
    if (JSON.stringify(snap) === JSON.stringify(e.payload)) this.writeLog(e, snap);
    else if (e.entity === 'setting') this.log.touchSetting(e.entityId);
    else this.log.touchPause();
  }

  /** Inserts or updates the row; null when the incoming entity is dropped (orphan, lost merge). */
  private upsertRow(entity: RowEntity, e: ChangeEntry, p: Record<string, unknown>): number | null {
    const db = this.db;
    const existing = localId(db, entity, e.entityId);
    switch (entity) {
      case 'user': {
        const username = this.uniqueName(
          e,
          'users',
          'username',
          str(p.username)!,
          existing,
          (n, i) => `${n}-${i}`,
        );
        if (username === null) return null;
        const vals = [
          username,
          str(p.passwordHash),
          str(p.role),
          bool(p.enabled),
          num(p.createdAt) ?? e.at,
          num(p.passwordChangedAt) ?? e.at,
        ];
        if (existing === null) {
          return db.run(
            `INSERT INTO users (username, password_hash, role, enabled, created_at, password_changed_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            vals,
          ).lastInsertRowid;
        }
        db.run(
          `UPDATE users SET username = ?, password_hash = ?, role = ?, enabled = ?, created_at = ?,
             password_changed_at = ? WHERE id = ?`,
          [...vals, existing],
        );
        return existing;
      }
      case 'team_member': {
        const vals = [str(p.name), str(p.verifier), num(p.joinedAt) ?? e.at, num(p.revokedAt)];
        if (existing === null) {
          return db.run(
            'INSERT INTO team_members (uuid, name, verifier, joined_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
            [e.entityId, ...vals],
          ).lastInsertRowid;
        }
        db.run(
          'UPDATE team_members SET name = ?, verifier = ?, joined_at = ?, revoked_at = ? WHERE id = ?',
          [...vals, existing],
        );
        return existing;
      }
      case 'room': {
        const name = this.uniqueName(
          e,
          'rooms',
          'name',
          str(p.name)!,
          existing,
          (n, i) => `${n} (${i})`,
        );
        const code = this.uniqueName(
          e,
          'rooms',
          'code',
          str(p.code)!,
          existing,
          (n, i) => `${n.slice(0, 13)}-${i}`,
        );
        if (name === null || code === null) return null;
        const vals = [
          name,
          code,
          str(p.block),
          str(p.floor),
          str(p.color),
          str(p.notes),
          str(p.directedBroadcast),
          num(p.batchSize),
          num(p.batchDelayMs),
        ];
        if (existing === null) {
          return db.run(
            `INSERT INTO rooms (name, code, block, floor, color, notes, directed_broadcast, batch_size,
               batch_delay_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [...vals, num(p.createdAt) ?? e.at, e.at],
          ).lastInsertRowid;
        }
        db.run(
          `UPDATE rooms SET name = ?, code = ?, block = ?, floor = ?, color = ?, notes = ?,
             directed_broadcast = ?, batch_size = ?, batch_delay_ms = ?, created_at = ? WHERE id = ?`,
          [...vals, num(p.createdAt) ?? e.at, existing],
        );
        return existing;
      }
      case 'tag': {
        const name = this.uniqueName(
          e,
          'tags',
          'name',
          str(p.name)!,
          existing,
          (n, i) => `${n.slice(0, 27)} (${i})`,
        );
        if (name === null) return null;
        if (existing === null) {
          return db.run('INSERT INTO tags (name, color) VALUES (?, ?)', [name, str(p.color)])
            .lastInsertRowid;
        }
        db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', [name, str(p.color), existing]);
        return existing;
      }
      case 'device':
        return this.upsertDevice(e, p, existing);
      case 'schedule': {
        const vals = [
          str(p.name),
          bool(p.enabled),
          num(p.weekdays),
          str(p.timeLocal),
          str(p.timezone),
          bool(p.onlyOffline),
          num(p.batchSize),
          num(p.batchDelayMs),
          num(p.confirmedCount),
          localId(db, 'user', str(p.createdBy)),
          num(p.createdAt) ?? e.at,
        ];
        let id = existing;
        if (id === null) {
          id = db.run(
            `INSERT INTO schedules (name, enabled, weekdays, time_local, timezone, only_offline, batch_size,
               batch_delay_ms, confirmed_count, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [...vals, e.at],
          ).lastInsertRowid;
        } else {
          db.run(
            `UPDATE schedules SET name = ?, enabled = ?, weekdays = ?, time_local = ?, timezone = ?,
               only_offline = ?, batch_size = ?, batch_delay_ms = ?, confirmed_count = ?, created_by = ?,
               created_at = ? WHERE id = ?`,
            [...vals, id],
          );
        }
        db.run('DELETE FROM schedule_targets WHERE schedule_id = ?', [id]);
        const table: Record<string, RowEntity> = { room: 'room', tag: 'tag', device: 'device' };
        for (const t of (p.targets as { type: string; ref: string | null }[] | undefined) ?? []) {
          const refEntity = table[t.type];
          db.run(
            'INSERT INTO schedule_targets (schedule_id, type, ref_id, ref_uuid) VALUES (?, ?, ?, ?)',
            [id, t.type, refEntity ? localId(db, refEntity, t.ref) : null, t.ref],
          );
        }
        return id;
      }
      case 'schedule_exception': {
        const scheduleUuid = str(p.schedule);
        const scheduleId = localId(db, 'schedule', scheduleUuid);
        if (scheduleUuid !== null && scheduleId === null) return this.dropOrphan(e);
        const vals = [scheduleId, str(p.startDate), str(p.endDate), str(p.description)];
        if (existing === null) {
          return db.run(
            'INSERT INTO schedule_exceptions (schedule_id, start_date, end_date, description) VALUES (?, ?, ?, ?)',
            vals,
          ).lastInsertRowid;
        }
        db.run(
          'UPDATE schedule_exceptions SET schedule_id = ?, start_date = ?, end_date = ?, description = ? WHERE id = ?',
          [...vals, existing],
        );
        return existing;
      }
      case 'schedule_run': {
        const scheduleId = localId(db, 'schedule', str(p.schedule));
        if (scheduleId === null) return this.dropOrphan(e);
        const vals = [num(p.claimedAt), str(p.status), str(p.detail), str(p.claimedBy)];
        const sameOccurrence =
          db.get<{ id: number }>(
            'SELECT id FROM schedule_runs WHERE schedule_id = ? AND planned_at = ?',
            [scheduleId, num(p.plannedAt)],
          )?.id ?? null;
        const id = existing ?? sameOccurrence;
        if (existing === null && sameOccurrence !== null) {
          // Same occurrence under another identity (cannot happen with v5 UUIDs; be safe): keep one.
          const old = db.get<{ uuid: string | null }>(
            'SELECT uuid FROM schedule_runs WHERE id = ?',
            [sameOccurrence],
          )?.uuid;
          if (old)
            db.run("DELETE FROM change_log WHERE entity = 'schedule_run' AND entity_id = ?", [old]);
        }
        if (id === null) {
          return db.run(
            `INSERT INTO schedule_runs (schedule_id, planned_at, claimed_at, status, detail, claimed_by_instance)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [scheduleId, num(p.plannedAt), ...vals],
          ).lastInsertRowid;
        }
        db.run(
          'UPDATE schedule_runs SET claimed_at = ?, status = ?, detail = ?, claimed_by_instance = ? WHERE id = ?',
          [...vals, id],
        );
        return id;
      }
    }
  }

  private upsertDevice(
    e: ChangeEntry,
    p: Record<string, unknown>,
    existing: number | null,
  ): number | null {
    const db = this.db;
    const mac = str(p.mac)!;
    const clash = db.get<{ id: number; uuid: string | null }>(
      'SELECT id, uuid FROM devices WHERE mac = ? AND id IS NOT ?',
      [mac, existing],
    );
    if (clash) {
      // ADR-040: the same MAC is one machine; the smaller UUID is kept everywhere.
      const localUuid = clash.uuid ?? this.log.uuidOf('device', clash.id)!;
      const localSnap = rowSnapshot(db, 'device', clash.id);
      if (localUuid < e.entityId) {
        this.conflictRaw(
          'device',
          e.entityId,
          'duplicate_mac',
          localSnap,
          e.payload,
          this.opts.peerInstance ?? null,
        );
        this.tombstoneIncoming(e);
        return null;
      }
      this.conflictRaw('device', localUuid, 'duplicate_mac', e.payload, localSnap, e.instance);
      this.log.tombstone('device', clash.id);
      this.deleteRow('device', clash.id);
    }
    const roomId = localId(db, 'room', str(p.room));
    const vals = [
      str(p.name),
      mac,
      str(p.ip),
      str(p.hostname),
      roomId,
      str(p.notes),
      bool(p.enabled),
      str(p.manufacturer),
      str(p.model),
      str(p.serial),
      str(p.os),
      JSON.stringify(p.otherMacs ?? []),
      num(p.preparedAt),
      jsonText(p.prepareResults),
      num(p.enrolledAt),
      num(p.createdAt) ?? e.at,
    ];
    let id = existing;
    if (id === null) {
      id = db.run(
        `INSERT INTO devices (name, mac, ip, hostname, room_id, notes, enabled, manufacturer, model, serial, os,
           other_macs, prepared_at, prepare_results, enrolled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...vals, e.at],
      ).lastInsertRowid;
      db.run('INSERT INTO device_state (device_id) VALUES (?)', [id]);
    } else {
      db.run(
        `UPDATE devices SET name = ?, mac = ?, ip = ?, hostname = ?, room_id = ?, notes = ?, enabled = ?,
           manufacturer = ?, model = ?, serial = ?, os = ?, other_macs = ?, prepared_at = ?, prepare_results = ?,
           enrolled_at = ?, created_at = ? WHERE id = ?`,
        [...vals, id],
      );
    }
    db.run('DELETE FROM device_tags WHERE device_id = ?', [id]);
    for (const t of (p.tags as string[] | undefined) ?? []) {
      const tagId = localId(db, 'tag', t);
      if (tagId !== null)
        db.run('INSERT OR IGNORE INTO device_tags (device_id, tag_id) VALUES (?, ?)', [id, tagId]);
    }
    this.maybeChanged.delete(id);
    return id;
  }

  /** The incoming entity lost a merge: tell everyone it is gone (a new local tombstone). */
  private tombstoneIncoming(e: ChangeEntry) {
    const instance = this.log.instanceId();
    const rev = this.db.get<{ clock: number }>(
      'UPDATE instance SET clock = clock + 1 WHERE id = 1 RETURNING clock',
    )!.clock;
    this.db.run('DELETE FROM change_log WHERE entity = ? AND entity_id = ?', [
      e.entity,
      e.entityId,
    ]);
    this.db.run(
      `INSERT INTO change_log (entity, entity_id, op, rev, instance_id, at, payload) VALUES (?, ?, 'delete', ?, ?, ?, NULL)`,
      [e.entity, e.entityId, rev, instance, this.opts.now],
    );
  }

  /** An exception or run whose schedule is gone here: deleted for everyone (ADR-040). */
  private dropOrphan(e: ChangeEntry): null {
    this.tombstoneIncoming(e);
    return null;
  }

  private conflictRaw(
    entity: EntityName,
    entityId: string,
    kind: ConflictKind,
    kept: unknown,
    discarded: unknown,
    winner: string | null,
  ) {
    this.conflicts.push({
      entity,
      entityId,
      label: labelOf(entity, kept ?? discarded),
      kind,
      kept,
      discarded,
      winnerInstance: winner,
    });
  }

  /**
   * ADR-040 for unique names: the larger UUID gets the next free suffix. Returns the name to store
   * for the incoming row (renaming the local row first when the local one loses).
   */
  private uniqueName(
    e: ChangeEntry,
    table: 'users' | 'rooms' | 'tags',
    column: 'username' | 'name' | 'code',
    wanted: string,
    existing: number | null,
    suffix: (name: string, i: number) => string,
  ): string | null {
    const db = this.db;
    const entity: RowEntity = table === 'users' ? 'user' : table === 'rooms' ? 'room' : 'tag';
    const clash = db.get<{ id: number; uuid: string | null }>(
      `SELECT id, uuid FROM ${table} WHERE ${column} = ? COLLATE NOCASE AND id IS NOT ?`,
      [wanted, existing],
    );
    if (!clash) return wanted;
    const free = (base: string) => {
      for (let i = 2; ; i++) {
        const candidate = suffix(base, i);
        if (!db.get(`SELECT 1 FROM ${table} WHERE ${column} = ? COLLATE NOCASE`, [candidate]))
          return candidate;
      }
    };
    const localUuid = clash.uuid ?? this.log.uuidOf(entity, clash.id)!;
    if (e.entityId > localUuid) {
      const renamed = free(wanted);
      this.conflictRaw(
        entity,
        e.entityId,
        'duplicate_name',
        { [column]: renamed },
        { [column]: wanted },
        null,
      );
      return renamed;
    }
    const renamed = free(wanted);
    db.run(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [renamed, clash.id]);
    this.log.touch(entity, clash.id);
    this.conflictRaw(
      entity,
      localUuid,
      'duplicate_name',
      { [column]: renamed },
      { [column]: wanted },
      null,
    );
    return wanted;
  }
}

function parse(v: string | null): unknown {
  return v === null ? null : (JSON.parse(v) as unknown);
}

function labelOf(entity: EntityName, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const name = [p.name, p.username, p.mac, p.description].find((v) => typeof v === 'string') ?? '';
  return `${entity}${name ? `: ${name}` : ''}`;
}

export function applyRemote(
  db: Db,
  entries: readonly ChangeEntry[],
  opts: ApplyOptions,
): ApplyResult {
  return new RemoteApplier(db, opts).run(entries);
}

/** Every change after `since` in our log (one row per entity), oldest first. */
export function changesSince(db: Db, since: number): { entries: ChangeEntry[]; seq: number } {
  const rows = db.all<{
    seq: number;
    entity: EntityName;
    entity_id: string;
    op: 'upsert' | 'delete';
    rev: number;
    instance_id: string;
    at: number;
    payload: string | null;
  }>('SELECT * FROM change_log WHERE seq > ? ORDER BY seq', [since]);
  const seq = db.get<{ s: number | null }>('SELECT MAX(seq) AS s FROM change_log')?.s ?? 0;
  return {
    entries: rows.map((r) => ({
      seq: r.seq,
      entity: r.entity,
      entityId: r.entity_id,
      op: r.op,
      rev: r.rev,
      instance: r.instance_id,
      at: r.at,
      payload: r.payload === null ? null : (JSON.parse(r.payload) as Record<string, unknown>),
    })),
    seq,
  };
}

/**
 * D7-01: a joining PC replaces its replicated data with the team's state in one transaction
 * (machine-local data stays). No tombstones: nobody else ever saw this PC's old data.
 */
export function replaceWithTeamState(
  db: Db,
  entries: readonly ChangeEntry[],
  now: number,
): ApplyResult {
  return db.transaction(() => {
    db.exec(`
      DELETE FROM schedule_runs; DELETE FROM schedule_exceptions; DELETE FROM schedules;
      DELETE FROM device_tags; DELETE FROM devices; DELETE FROM tags; DELETE FROM rooms;
      DELETE FROM sessions; DELETE FROM users; DELETE FROM team_members; DELETE FROM settings;
      DELETE FROM change_log;`);
    db.run('DELETE FROM system_state WHERE key = ?', [PAUSE_KEY]);
    return applyRemote(db, entries, { now });
  });
}

export const PAUSE_ENTITY_ID = PAUSE_ID;
