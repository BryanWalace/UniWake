/**
 * v1.6 field fixes (spec §6d, ADR-053..056). Machine-local additions only: what agenda each lab PC
 * last received (diagnostics, reconciliation), which signal confirmed a device's status and where
 * its IP came from, and the one-off "Testar agendamento" items. Replicated snapshots are unchanged.
 */
export const sql = /* sql */ `
ALTER TABLE agent_seen ADD COLUMN agenda_version TEXT;
ALTER TABLE agent_seen ADD COLUMN agenda_items INTEGER;
ALTER TABLE agent_seen ADD COLUMN agenda_served_at INTEGER;

ALTER TABLE device_state ADD COLUMN seen_via TEXT;
ALTER TABLE device_state ADD COLUMN ip_source TEXT;
ALTER TABLE device_state ADD COLUMN ip_seen_at INTEGER;

CREATE TABLE power_tests (
  id              INTEGER PRIMARY KEY,
  uuid            TEXT    NOT NULL UNIQUE,
  device_id       INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  at              INTEGER NOT NULL,
  warning_minutes INTEGER NOT NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  pushed_at       INTEGER,
  reconciled_at   INTEGER
);
CREATE INDEX power_tests_at ON power_tests(at);

-- ADR-054: occurrences this hub already reconciled at T + 10 min (once, with their counts).
CREATE TABLE power_reconciled (
  occurrence    TEXT    PRIMARY KEY,
  reconciled_at INTEGER NOT NULL,
  counts        TEXT    NOT NULL
);
`;
