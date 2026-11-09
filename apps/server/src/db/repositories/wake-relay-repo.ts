/**
 * v1.7.0 relay requests (FR-701.3, ADR-063; machine-local, migration 010): which awake lab PC was
 * asked to broadcast which MAC, for which wake job and round, and when it picked the request up.
 */
import type { RelayPeer, WakeRelayStore } from '../../application/wake/relay-service';
import type { Db } from '../connection';

export class SqliteWakeRelayRepo implements WakeRelayStore {
  constructor(private readonly db: Db) {}

  peers(since: number): RelayPeer[] {
    return this.db
      .all<{
        device_id: number;
        name: string;
        ip: string | null;
        room_id: number | null;
        agent_version: string | null;
        seen_at: number;
      }>(
        `SELECT d.id AS device_id, d.name, COALESCE(s.ip, d.ip) AS ip, d.room_id, a.agent_version,
                s.seen_at
           FROM agent_seen s
           JOIN devices d ON d.id = s.device_id
           JOIN device_agents a ON a.device_id = d.id
          WHERE s.seen_at >= ? AND a.revoked_at IS NULL AND a.token_hash IS NOT NULL
            AND d.enabled = 1`,
        [since],
      )
      .map((r) => ({
        deviceId: r.device_id,
        name: r.name,
        ip: r.ip,
        roomId: r.room_id,
        agentVersion: r.agent_version,
        seenAt: r.seen_at,
      }));
  }

  insert(rows: Parameters<WakeRelayStore['insert']>[0]): number {
    let n = 0;
    for (const r of rows) {
      n += this.db.run(
        `INSERT OR IGNORE INTO wake_relays
           (job_id, device_id, relay_device_id, mac, round, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.jobId, r.deviceId, r.relayDeviceId, r.mac, r.round, r.createdAt, r.expiresAt],
      ).changes;
    }
    return n;
  }

  due(relayDeviceId: number, now: number, limit: number): { id: number; mac: string }[] {
    return this.db.all<{ id: number; mac: string }>(
      `SELECT id, mac FROM wake_relays
        WHERE relay_device_id = ? AND delivered_at IS NULL AND expires_at > ?
        ORDER BY id LIMIT ?`,
      [relayDeviceId, now, limit],
    );
  }

  markDelivered(ids: readonly number[], at: number): void {
    for (const id of ids) {
      this.db.run('UPDATE wake_relays SET delivered_at = ? WHERE id = ?', [at, id]);
    }
  }

  match(
    relayDeviceId: number,
    mac: string,
    at: number,
  ): { jobId: number; deviceId: number; round: number } | null {
    // The agent's clock may differ from the hub's by a little: a 10-minute look-back is enough.
    const r = this.db.get<{ job_id: number; device_id: number; round: number }>(
      `SELECT job_id, device_id, round FROM wake_relays
        WHERE relay_device_id = ? AND mac = ? AND delivered_at IS NOT NULL
          AND delivered_at >= ? - 600000 AND delivered_at <= ? + 600000
        ORDER BY delivered_at DESC, id DESC LIMIT 1`,
      [relayDeviceId, mac, at, at],
    );
    return r ? { jobId: r.job_id, deviceId: r.device_id, round: r.round } : null;
  }

  device(id: number): { name: string; ip: string | null } | null {
    return (
      this.db.get<{ name: string; ip: string | null }>(
        `SELECT d.name, COALESCE(s.ip, d.ip) AS ip FROM devices d
           LEFT JOIN agent_seen s ON s.device_id = d.id WHERE d.id = ?`,
        [id],
      ) ?? null
    );
  }
}
