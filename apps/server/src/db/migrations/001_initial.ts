/** Initial schema (plan §5). Times are epoch ms UTC; booleans 0/1; JSON as TEXT. */
export const sql = /* sql */ `
CREATE TABLE rooms (
  id                 INTEGER PRIMARY KEY,
  name               TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  code               TEXT    NOT NULL UNIQUE,
  block              TEXT,
  floor              TEXT,
  color              TEXT    NOT NULL,
  notes              TEXT,
  batch_size         INTEGER,
  batch_delay_ms     INTEGER,
  directed_broadcast TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE devices (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  mac             TEXT    NOT NULL UNIQUE,
  ip              TEXT,
  hostname        TEXT,
  room_id         INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  notes           TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  manufacturer    TEXT,
  model           TEXT,
  serial          TEXT,
  os              TEXT,
  other_macs      TEXT    NOT NULL DEFAULT '[]',
  prepared_at     INTEGER,
  prepare_results TEXT,
  enrolled_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX devices_room ON devices(room_id);
CREATE INDEX devices_ip ON devices(ip);
CREATE INDEX devices_hostname ON devices(hostname COLLATE NOCASE);
CREATE INDEX devices_name ON devices(name COLLATE NOCASE);

CREATE TABLE device_state (
  device_id            INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  status               TEXT    NOT NULL DEFAULT 'desconhecido'
                       CHECK (status IN ('online', 'offline', 'desconhecido')),
  latency_ms           INTEGER,
  last_seen_at         INTEGER,
  online_since         INTEGER,
  last_probe_at        INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ever_online          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL COLLATE NOCASE UNIQUE,
  color TEXT NOT NULL
);

CREATE TABLE device_tags (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (device_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX device_tags_tag ON device_tags(tag_id);

CREATE TABLE device_events (
  id        INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  at        INTEGER NOT NULL,
  type      TEXT    NOT NULL CHECK (type IN ('status', 'ip_changed', 'moved', 'enrolled')),
  data      TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX device_events_device_at ON device_events(device_id, at);
CREATE INDEX device_events_at ON device_events(at);

CREATE TABLE daily_uptime (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day       TEXT    NOT NULL,
  online_ms INTEGER NOT NULL,
  PRIMARY KEY (device_id, day)
) WITHOUT ROWID;

CREATE TABLE schedules (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  weekdays        INTEGER NOT NULL CHECK (weekdays BETWEEN 1 AND 127),
  time_local      TEXT    NOT NULL,
  timezone        TEXT    NOT NULL,
  only_offline    INTEGER NOT NULL DEFAULT 0,
  batch_size      INTEGER,
  batch_delay_ms  INTEGER,
  confirmed_count INTEGER,
  created_by      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE schedule_targets (
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL CHECK (type IN ('room', 'tag', 'device', 'all', 'no_room')),
  ref_id      INTEGER
);
CREATE INDEX schedule_targets_schedule ON schedule_targets(schedule_id);
CREATE INDEX schedule_targets_ref ON schedule_targets(type, ref_id);

CREATE TABLE schedule_exceptions (
  id          INTEGER PRIMARY KEY,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE CASCADE,
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,
  description TEXT    NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE TABLE wake_jobs (
  id              INTEGER PRIMARY KEY,
  source          TEXT    NOT NULL CHECK (source IN ('manual', 'schedule', 'test')),
  schedule_run_id INTEGER,
  requested_by    INTEGER,
  target          TEXT    NOT NULL,
  only_offline    INTEGER NOT NULL DEFAULT 0,
  dry_run         INTEGER NOT NULL DEFAULT 0,
  state           TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER,
  verify_until    INTEGER,
  summary         TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX wake_jobs_state ON wake_jobs(state);
CREATE INDEX wake_jobs_created ON wake_jobs(created_at);

CREATE TABLE schedule_runs (
  id          INTEGER PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  planned_at  INTEGER NOT NULL,
  claimed_at  INTEGER NOT NULL,
  status      TEXT    NOT NULL,
  detail      TEXT,
  job_id      INTEGER REFERENCES wake_jobs(id) ON DELETE SET NULL,
  UNIQUE (schedule_id, planned_at)
);
CREATE INDEX schedule_runs_planned ON schedule_runs(planned_at);

CREATE TABLE wake_job_devices (
  job_id          INTEGER NOT NULL REFERENCES wake_jobs(id) ON DELETE CASCADE,
  device_id       INTEGER NOT NULL,
  mac             TEXT    NOT NULL,
  room_id         INTEGER,
  batch_index     INTEGER NOT NULL DEFAULT 0,
  result          TEXT    NOT NULL,
  sent_at         INTEGER,
  woke_at         INTEGER,
  excluded_reason TEXT,
  PRIMARY KEY (job_id, device_id)
) WITHOUT ROWID;
CREATE INDEX wake_job_devices_device ON wake_job_devices(device_id);

CREATE TABLE packet_log (
  id        INTEGER PRIMARY KEY,
  job_id    INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  mac       TEXT    NOT NULL,
  src_ip    TEXT    NOT NULL,
  dst_ip    TEXT    NOT NULL,
  port      INTEGER NOT NULL,
  repeat    INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  outcome   TEXT    NOT NULL CHECK (outcome IN ('sent', 'error', 'dry_run')),
  error     TEXT
);
CREATE INDEX packet_log_job ON packet_log(job_id);
CREATE INDEX packet_log_device ON packet_log(device_id, at);
CREATE INDEX packet_log_at ON packet_log(at);

CREATE TABLE users (
  id                  INTEGER PRIMARY KEY,
  username            TEXT    NOT NULL UNIQUE,
  password_hash       TEXT    NOT NULL,
  role                TEXT    NOT NULL CHECK (role IN ('admin', 'operator')),
  enabled             INTEGER NOT NULL DEFAULT 1,
  failed_logins       INTEGER NOT NULL DEFAULT 0,
  last_failed_at      INTEGER,
  created_at          INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash      TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT
) WITHOUT ROWID;
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  actor_user_id INTEGER,
  actor_label   TEXT    NOT NULL,
  action        TEXT    NOT NULL,
  target        TEXT,
  result        TEXT    NOT NULL,
  source_ip     TEXT,
  details       TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at ON audit_log(at);
CREATE INDEX audit_log_action ON audit_log(action, at);

CREATE TABLE settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
) WITHOUT ROWID;

CREATE TABLE system_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE enrollment_tokens (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT    NOT NULL UNIQUE,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses   INTEGER NOT NULL,
  uses       INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);

CREATE TABLE notices (
  id              INTEGER PRIMARY KEY,
  type            TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  data            TEXT    NOT NULL DEFAULT '{}',
  acknowledged_at INTEGER,
  acknowledged_by INTEGER
);
CREATE INDEX notices_open ON notices(acknowledged_at, created_at);

CREATE TABLE backups (
  id         INTEGER PRIMARY KEY,
  file       TEXT    NOT NULL UNIQUE,
  kind       TEXT    NOT NULL CHECK (kind IN ('daily', 'pre-migration', 'pre-update', 'pre-restore', 'manual')),
  created_at INTEGER NOT NULL,
  size       INTEGER NOT NULL
);
`;
