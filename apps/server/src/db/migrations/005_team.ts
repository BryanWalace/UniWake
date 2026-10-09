/**
 * Modo equipe (v1.2; ADR-035..038, plan §14.2). `team_members` is replicated (entity
 * `team_member`, UUID = the member's instance id); the other tables are machine-local.
 */
export const sql = /* sql */ `
CREATE TABLE team (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  team_id            TEXT    NOT NULL,
  epoch              INTEGER NOT NULL,
  key_blob           BLOB    NOT NULL,
  prev_epoch         INTEGER,
  prev_key_blob      BLOB,
  member_secret_blob BLOB    NOT NULL,
  joined_at          INTEGER NOT NULL
);

CREATE TABLE team_members (
  id                  INTEGER PRIMARY KEY,
  uuid                TEXT    UNIQUE,
  name                TEXT    NOT NULL,
  verifier            TEXT    NOT NULL,
  joined_at           INTEGER NOT NULL,
  revoked_at          INTEGER,
  rev                 INTEGER NOT NULL DEFAULT 0,
  updated_by_instance TEXT,
  updated_at          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX team_members_rev ON team_members(rev);

CREATE TABLE sync_peers (
  instance_id    TEXT    PRIMARY KEY,
  address        TEXT,
  manual_address TEXT,
  port           INTEGER,
  last_seen_at   INTEGER,
  last_sync_at   INTEGER,
  last_error     TEXT,
  pulled_seq     INTEGER NOT NULL DEFAULT 0,
  acked_seq      INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE sync_conflicts (
  id              INTEGER PRIMARY KEY,
  at              INTEGER NOT NULL,
  entity          TEXT    NOT NULL,
  entity_id       TEXT    NOT NULL,
  label           TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('concurrent', 'duplicate_mac', 'duplicate_name')),
  kept            TEXT    NOT NULL,
  discarded       TEXT    NOT NULL,
  winner_instance TEXT
);
CREATE INDEX sync_conflicts_at ON sync_conflicts(at);

-- FR-201.2: the automatic backup taken before a PC adopts the team's data.
CREATE TABLE backups_new (
  id         INTEGER PRIMARY KEY,
  file       TEXT    NOT NULL UNIQUE,
  kind       TEXT    NOT NULL CHECK (kind IN ('daily', 'pre-migration', 'pre-update', 'pre-restore', 'pre-join', 'manual')),
  created_at INTEGER NOT NULL,
  size       INTEGER NOT NULL
);
INSERT INTO backups_new SELECT id, file, kind, created_at, size FROM backups;
DROP TABLE backups;
ALTER TABLE backups_new RENAME TO backups;
`;
