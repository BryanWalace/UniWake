/**
 * This installation's identity and Lamport clock (ADR-033). Machine-local: never synced or
 * exported. Created on first use, so every database that has a change log has an identity.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../connection';

export interface InstanceInfo {
  instanceId: string;
  createdAt: number;
  clock: number;
}

export function readInstance(db: Db): InstanceInfo | undefined {
  return db.get<InstanceInfo>(
    'SELECT instance_id AS instanceId, created_at AS createdAt, clock FROM instance WHERE id = 1',
  );
}

/** Returns the installation's identity, creating it on first start. */
export function ensureInstance(db: Db, now: number): InstanceInfo {
  db.run(
    'INSERT OR IGNORE INTO instance (id, instance_id, created_at, clock) VALUES (1, ?, ?, 0)',
    [randomUUID(), now],
  );
  return readInstance(db)!;
}

/** Next Lamport value for a local write. */
export function nextRev(db: Db): number {
  return db.get<{ clock: number }>(
    'UPDATE instance SET clock = clock + 1 WHERE id = 1 RETURNING clock',
  )!.clock;
}

/**
 * After a restore (ADR-033): a new identity, because the restored change log restarts from older
 * sequence numbers, and a clock at least at the highest revision in the restored data.
 */
export function rotateInstance(db: Db, now: number): InstanceInfo {
  ensureInstance(db, now);
  const maxRev = db.get<{ m: number | null }>('SELECT MAX(rev) AS m FROM change_log')?.m ?? 0;
  db.run(
    'UPDATE instance SET instance_id = ?, created_at = ?, clock = MAX(clock, ?) WHERE id = 1',
    [randomUUID(), now, maxRev],
  );
  return readInstance(db)!;
}
