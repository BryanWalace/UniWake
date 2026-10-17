/**
 * v1.6.0 agent health (spec §6e, FR-603/604, ADR-059/060). Machine-local, like `agent_seen`: the
 * last health a lab PC sent to this hub (self-update outcome, repair notes, antivirus) and the last
 * alert of its repair task. JSON columns hold the validated, size-limited contract objects.
 */
export const sql = /* sql */ `
CREATE TABLE agent_health (
  device_id      INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  received_at    INTEGER NOT NULL,
  install_level  INTEGER,
  update_json    TEXT,
  repairs_json   TEXT,
  antivirus_json TEXT,
  antivirus_at   INTEGER,
  alert_file     TEXT,
  alert_at       INTEGER,
  power_json     TEXT
);
`;
