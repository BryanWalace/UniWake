/**
 * v1.3 shutdown (spec §6b, plan §15.3, ADR-042..048). Adds the shutdown fields to schedules, the
 * "never shut down by a schedule" flag to devices and the agent/power tables. Only adds: nothing
 * registered is lost. The snapshots of schedules, devices and team members gain fields, so their
 * `rev` goes back to 0 and the start-up baseline logs them again in the new shape (ADR-048).
 *
 * Replicated: `device_agents`, `power_jobs`, `power_orders`, `power_reports` (wired into sync in
 * M17-T06). Machine-local: `agent_seen`, `hub_keys`.
 */
export const sql = /* sql */ `
ALTER TABLE schedules ADD COLUMN action TEXT NOT NULL DEFAULT 'wake' CHECK (action IN ('wake', 'shutdown'));
ALTER TABLE schedules ADD COLUMN warning_minutes INTEGER;
ALTER TABLE schedules ADD COLUMN allow_postpone INTEGER;
ALTER TABLE schedules ADD COLUMN postpone_max INTEGER;
ALTER TABLE schedules ADD COLUMN postpone_minutes INTEGER;
-- Tag UUIDs whose devices this shutdown schedule skips (FR-306.2); unknown UUIDs are ignored.
ALTER TABLE schedules ADD COLUMN exclude_tags TEXT NOT NULL DEFAULT '[]';
UPDATE schedules SET rev = 0;

ALTER TABLE devices ADD COLUMN never_scheduled_shutdown INTEGER NOT NULL DEFAULT 0;
UPDATE devices SET rev = 0;

ALTER TABLE team_members ADD COLUMN signing_key_id TEXT;
ALTER TABLE team_members ADD COLUMN signing_public_jwk TEXT;
UPDATE team_members SET rev = 0;

CREATE TABLE device_agents (
  id                  INTEGER PRIMARY KEY,
  uuid                TEXT    UNIQUE,
  device_id           INTEGER NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
  token_hash          TEXT,
  pending_token_hash  TEXT,
  issued_at           INTEGER,
  rotated_at          INTEGER,
  revoked_at          INTEGER,
  agent_version       TEXT,
  protocol            INTEGER,
  freeze_product      TEXT,
  freeze_state        TEXT,
  persistent          INTEGER NOT NULL DEFAULT 0,
  sleep_after_minutes INTEGER,
  wake_timers         TEXT,
  seen_coarse_at      INTEGER,
  rev                 INTEGER NOT NULL DEFAULT 0,
  updated_by_instance TEXT,
  updated_at          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX device_agents_rev ON device_agents(rev);
CREATE INDEX device_agents_token ON device_agents(token_hash);
CREATE INDEX device_agents_pending ON device_agents(pending_token_hash);

CREATE TABLE power_jobs (
  id                  INTEGER PRIMARY KEY,
  uuid                TEXT    UNIQUE,
  action              TEXT    NOT NULL CHECK (action IN ('shutdown', 'restart')),
  target              TEXT    NOT NULL,
  warning_minutes     INTEGER NOT NULL,
  allow_postpone      INTEGER NOT NULL,
  postpone_max        INTEGER NOT NULL,
  postpone_minutes    INTEGER NOT NULL,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL,
  rev                 INTEGER NOT NULL DEFAULT 0,
  updated_by_instance TEXT,
  updated_at          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX power_jobs_rev ON power_jobs(rev);
CREATE INDEX power_jobs_created ON power_jobs(created_at);

CREATE TABLE power_orders (
  id                    INTEGER PRIMARY KEY,
  uuid                  TEXT    UNIQUE,
  job_id                INTEGER REFERENCES power_jobs(id) ON DELETE CASCADE,
  device_id             INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  action                TEXT    NOT NULL CHECK (action IN ('shutdown', 'restart', 'cancel')),
  warning_minutes       INTEGER NOT NULL,
  allow_postpone        INTEGER NOT NULL,
  postpone_max          INTEGER NOT NULL,
  postpone_minutes      INTEGER NOT NULL,
  state                 TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending', 'delivered', 'warning', 'executed', 'cancelled', 'expired', 'failed')),
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  delivered_at          INTEGER,
  delivered_by_instance TEXT,
  executed_at           INTEGER,
  detail                TEXT,
  rev                   INTEGER NOT NULL DEFAULT 0,
  updated_by_instance   TEXT,
  updated_at            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX power_orders_rev ON power_orders(rev);
CREATE INDEX power_orders_device_state ON power_orders(device_id, state);
CREATE INDEX power_orders_job ON power_orders(job_id);

-- Insert-only; UUID made by the lab PC. No user-name column on purpose (LGPD, owner Q-6).
CREATE TABLE power_reports (
  id                  INTEGER PRIMARY KEY,
  uuid                TEXT    UNIQUE NOT NULL,
  device_id           INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  occurrence_uuid     TEXT,
  order_uuid          TEXT,
  action              TEXT    NOT NULL CHECK (action IN ('shutdown', 'restart')),
  outcome             TEXT    NOT NULL CHECK (outcome IN ('done', 'cancelled', 'skipped', 'failed')),
  reason              TEXT,
  planned_at          INTEGER,
  executed_at         INTEGER,
  postpones           INTEGER NOT NULL DEFAULT 0,
  user_logged_on      INTEGER,
  session_count       INTEGER,
  was_asleep          INTEGER NOT NULL DEFAULT 0,
  late_minutes        INTEGER,
  native_warning      INTEGER NOT NULL DEFAULT 0,
  freeze_state        TEXT,
  detail              TEXT,
  received_at         INTEGER NOT NULL,
  rev                 INTEGER NOT NULL DEFAULT 0,
  updated_by_instance TEXT,
  updated_at          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX power_reports_rev ON power_reports(rev);
CREATE INDEX power_reports_occurrence ON power_reports(occurrence_uuid);
CREATE INDEX power_reports_order ON power_reports(order_uuid);
CREATE INDEX power_reports_device ON power_reports(device_id, received_at);

CREATE TABLE agent_seen (
  device_id       INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  seen_at         INTEGER NOT NULL,
  ip              TEXT,
  boot_time       INTEGER,
  clock_offset_ms INTEGER,
  user_logged_on  INTEGER,
  session_count   INTEGER
);

CREATE TABLE hub_keys (
  key_id       TEXT    PRIMARY KEY,
  public_jwk   TEXT    NOT NULL,
  private_blob BLOB    NOT NULL,
  created_at   INTEGER NOT NULL,
  retired_at   INTEGER
) WITHOUT ROWID;
`;
