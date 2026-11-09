/**
 * v1.7.0 "Ligar e desligar garantidos" (spec §6f, ADR-063..066). Machine-local additions only:
 * - `packet_log.round` / `via`: which wake attempt a packet belongs to (0 = first) and, for a packet
 *   an awake lab PC sent on the hub's request, that machine's name (null = sent by this hub).
 * - `wake_relays`: the hub's requests to awake lab PCs to send a magic packet in their own network,
 *   delivered in their next signed check-in answer.
 * - `agent_health`: Wake-on-LAN readiness, forced shutdowns and recent agent errors.
 */
export const sql = /* sql */ `
ALTER TABLE packet_log ADD COLUMN round INTEGER NOT NULL DEFAULT 0;
ALTER TABLE packet_log ADD COLUMN via TEXT;

CREATE TABLE wake_relays (
  id              INTEGER PRIMARY KEY,
  job_id          INTEGER NOT NULL,
  device_id       INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  relay_device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  mac             TEXT    NOT NULL,
  round           INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  delivered_at    INTEGER,
  UNIQUE (job_id, round, device_id, relay_device_id)
);
CREATE INDEX wake_relays_relay ON wake_relays(relay_device_id, expires_at);
CREATE INDEX wake_relays_mac ON wake_relays(relay_device_id, mac, delivered_at);

ALTER TABLE agent_health ADD COLUMN wol_json TEXT;
ALTER TABLE agent_health ADD COLUMN escalations_json TEXT;
ALTER TABLE agent_health ADD COLUMN errors_json TEXT;
`;
