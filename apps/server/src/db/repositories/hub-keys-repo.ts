import type { HubKeyRow, HubKeysRepo, PublicJwk } from '../../application/power/hub-key';
import type { Db } from '../connection';

/** Machine-local signing keys (`hub_keys`, migration 006): never replicated or exported. */
export class SqliteHubKeysRepo implements HubKeysRepo {
  constructor(private readonly db: Db) {}

  active(): HubKeyRow | undefined {
    const r = this.db.get<{
      key_id: string;
      public_jwk: string;
      private_blob: Uint8Array;
      created_at: number;
    }>(
      'SELECT key_id, public_jwk, private_blob, created_at FROM hub_keys WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1',
    );
    return (
      r && {
        keyId: r.key_id,
        publicJwk: JSON.parse(r.public_jwk) as PublicJwk,
        privateBlob: Buffer.from(r.private_blob),
        createdAt: r.created_at,
      }
    );
  }

  insert(row: HubKeyRow): void {
    this.db.run(
      'INSERT INTO hub_keys (key_id, public_jwk, private_blob, created_at) VALUES (?, ?, ?, ?)',
      [row.keyId, JSON.stringify(row.publicJwk), row.privateBlob, row.createdAt],
    );
  }

  retire(keyId: string, at: number): void {
    this.db.run('UPDATE hub_keys SET retired_at = ? WHERE key_id = ?', [at, keyId]);
  }
}
