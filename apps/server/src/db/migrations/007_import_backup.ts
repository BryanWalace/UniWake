/**
 * v1.4 "Backup e migração" (spec §6c, FR-403.4): the database backup taken before an import gets
 * its own kind, so "Desfazer importação" can find it. SQLite cannot change a CHECK in place, so the
 * table is rebuilt with every row kept.
 */
export const sql = /* sql */ `
CREATE TABLE backups_new (
  id         INTEGER PRIMARY KEY,
  file       TEXT    NOT NULL UNIQUE,
  kind       TEXT    NOT NULL CHECK (kind IN ('daily', 'pre-migration', 'pre-update', 'pre-restore', 'pre-join', 'pre-import', 'manual')),
  created_at INTEGER NOT NULL,
  size       INTEGER NOT NULL
);
INSERT INTO backups_new SELECT id, file, kind, created_at, size FROM backups;
DROP TABLE backups;
ALTER TABLE backups_new RENAME TO backups;
`;
