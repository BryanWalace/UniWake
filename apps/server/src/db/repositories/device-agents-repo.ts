import type { FreezeState } from '@uniwake/shared';
import type { DeviceAgentRow, DeviceAgentsRepo } from '../../application/power/agent-tokens';
import type { Db } from '../connection';
import { changeLog } from '../sync/change-log';

interface Row {
  device_id: number;
  token_hash: string | null;
  pending_token_hash: string | null;
  issued_at: number | null;
  rotated_at: number | null;
  revoked_at: number | null;
  agent_version: string | null;
  protocol: number | null;
  freeze_product: string | null;
  freeze_state: string | null;
  persistent: number;
  sleep_after_minutes: number | null;
  wake_timers: string | null;
  seen_coarse_at: number | null;
}

const toRow = (r: Row): DeviceAgentRow => ({
  deviceId: r.device_id,
  tokenHash: r.token_hash,
  pendingTokenHash: r.pending_token_hash,
  issuedAt: r.issued_at,
  rotatedAt: r.rotated_at,
  revokedAt: r.revoked_at,
  agentVersion: r.agent_version,
  protocol: r.protocol,
  freezeProduct: r.freeze_product,
  freezeState: r.freeze_state as FreezeState | null,
  persistent: r.persistent === 1,
  sleepAfterMinutes: r.sleep_after_minutes,
  wakeTimers: r.wake_timers,
  seenCoarseAt: r.seen_coarse_at,
});

/** `device_agents` (migration 006), replicated as `device_agent` (ADR-048): every write is logged. */
export class SqliteDeviceAgentsRepo implements DeviceAgentsRepo {
  constructor(private readonly db: Db) {}

  private log(deviceId: number): void {
    const id = this.db.get<{ id: number }>('SELECT id FROM device_agents WHERE device_id = ?', [
      deviceId,
    ])?.id;
    if (id !== undefined) changeLog(this.db).touch('device_agent', id);
  }

  byDevice(deviceId: number): DeviceAgentRow | undefined {
    const r = this.db.get<Row>('SELECT * FROM device_agents WHERE device_id = ?', [deviceId]);
    return r && toRow(r);
  }

  byTokenHash(hash: string): DeviceAgentRow | undefined {
    const r = this.db.get<Row>(
      'SELECT * FROM device_agents WHERE token_hash = ? OR pending_token_hash = ?',
      [hash, hash],
    );
    return r && toRow(r);
  }

  issue(deviceId: number, hash: string, now: number): void {
    this.db.run(
      `INSERT INTO device_agents (device_id, token_hash, pending_token_hash, issued_at, rotated_at, revoked_at, protocol)
       VALUES (?, ?, NULL, ?, ?, NULL, 1)
       ON CONFLICT(device_id) DO UPDATE SET token_hash = excluded.token_hash, pending_token_hash = NULL,
         issued_at = excluded.issued_at, rotated_at = excluded.rotated_at, revoked_at = NULL`,
      [deviceId, hash, now, now],
    );
    this.log(deviceId);
  }

  setPending(deviceId: number, hash: string): void {
    this.db.run('UPDATE device_agents SET pending_token_hash = ? WHERE device_id = ?', [
      hash,
      deviceId,
    ]);
    this.log(deviceId);
  }

  promotePending(deviceId: number, now: number): void {
    this.db.run(
      `UPDATE device_agents SET token_hash = pending_token_hash, pending_token_hash = NULL, rotated_at = ?
       WHERE device_id = ? AND pending_token_hash IS NOT NULL`,
      [now, deviceId],
    );
    this.log(deviceId);
  }

  revoke(deviceId: number, now: number): void {
    this.db.run(
      'UPDATE device_agents SET revoked_at = ?, pending_token_hash = NULL WHERE device_id = ?',
      [now, deviceId],
    );
    this.log(deviceId);
  }
}
