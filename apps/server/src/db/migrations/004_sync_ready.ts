/**
 * Sync-ready data (ADR-031..033, plan §5.2). Only adds tables and columns and moves machine-scope
 * settings with their values: nothing registered is lost. Existing rows keep `rev = 0` and get their
 * UUID and first change-log row from the start-up baseline (`baselineChangeLog`).
 */
export const MACHINE_SETTING_KEYS_004 = [
  'wake.interfaces',
  'wake.dryRun',
  'panel.lanEnabled',
  'panel.lanAddress',
  'enrollment.hubAddress',
  'update.mode',
  'update.windowStart',
  'update.windowEnd',
  'update.checkIntervalHours',
  'backup.time',
  'backup.retention',
] as const;

const keys = MACHINE_SETTING_KEYS_004.map((k) => `'${k}'`).join(', ');

const replicated = (table: string, withUpdatedAt: boolean) => /* sql */ `
ALTER TABLE ${table} ADD COLUMN uuid TEXT;
ALTER TABLE ${table} ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ${table} ADD COLUMN updated_by_instance TEXT;
${withUpdatedAt ? `ALTER TABLE ${table} ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;` : ''}
CREATE UNIQUE INDEX ${table}_uuid ON ${table}(uuid);
CREATE INDEX ${table}_rev ON ${table}(rev);
`;

export const sql = /* sql */ `
CREATE TABLE instance (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  instance_id TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  clock       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE change_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT    NOT NULL,
  entity_id   TEXT    NOT NULL,
  op          TEXT    NOT NULL CHECK (op IN ('upsert', 'delete')),
  rev         INTEGER NOT NULL,
  instance_id TEXT    NOT NULL,
  at          INTEGER NOT NULL,
  payload     TEXT,
  UNIQUE (entity, entity_id)
);

CREATE TABLE machine_settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
) WITHOUT ROWID;
INSERT INTO machine_settings (key, value, updated_at, updated_by)
  SELECT key, value, updated_at, updated_by FROM settings WHERE key IN (${keys});
DELETE FROM settings WHERE key IN (${keys});
ALTER TABLE settings ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN updated_by_instance TEXT;

${replicated('rooms', false)}
${replicated('tags', true)}
${replicated('devices', false)}
${replicated('schedules', false)}
${replicated('schedule_exceptions', true)}
${replicated('users', true)}
${replicated('schedule_runs', true)}
ALTER TABLE schedule_runs ADD COLUMN claimed_by_instance TEXT;
ALTER TABLE schedule_targets ADD COLUMN ref_uuid TEXT;
`;
