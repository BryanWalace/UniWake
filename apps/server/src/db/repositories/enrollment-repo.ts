import type {
  EnrollmentRepo,
  EnrollmentTokenRow,
  EnrollmentTokenView,
} from '../../application/enrollment/enrollment-service';
import type { Db } from '../connection';

interface Row {
  id: number;
  token_hash: string;
  room_id: number;
  created_by: number | null;
  created_at: number;
  expires_at: number;
  max_uses: number;
  uses: number;
  revoked_at: number | null;
  room_name: string;
  room_code: string;
  created_by_name: string | null;
}

const SELECT = `SELECT t.*, r.name AS room_name, r.code AS room_code, u.username AS created_by_name
  FROM enrollment_tokens t
  JOIN rooms r ON r.id = t.room_id
  LEFT JOIN users u ON u.id = t.created_by`;

const toView = (r: Row): EnrollmentTokenView => ({
  id: r.id,
  tokenHash: r.token_hash,
  roomId: r.room_id,
  createdBy: r.created_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  maxUses: r.max_uses,
  uses: r.uses,
  revokedAt: r.revoked_at,
  roomName: r.room_name,
  roomCode: r.room_code,
  createdByName: r.created_by_name,
});

export class SqliteEnrollmentRepo implements EnrollmentRepo {
  constructor(private readonly db: Db) {}

  insertToken(t: Omit<EnrollmentTokenRow, 'id' | 'uses' | 'revokedAt'>): number {
    return this.db.run(
      `INSERT INTO enrollment_tokens (token_hash, room_id, created_by, created_at, expires_at, max_uses)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [t.tokenHash, t.roomId, t.createdBy, t.createdAt, t.expiresAt, t.maxUses],
    ).lastInsertRowid;
  }

  getToken(id: number): EnrollmentTokenView | undefined {
    const r = this.db.get<Row>(`${SELECT} WHERE t.id = ?`, [id]);
    return r ? toView(r) : undefined;
  }

  findByHash(hash: string): EnrollmentTokenView | undefined {
    const r = this.db.get<Row>(`${SELECT} WHERE t.token_hash = ?`, [hash]);
    return r ? toView(r) : undefined;
  }

  listTokens(since: number, now: number, limit: number): EnrollmentTokenView[] {
    return this.db
      .all<Row>(
        `${SELECT}
         WHERE t.created_at >= ? OR (t.revoked_at IS NULL AND t.expires_at > ? AND t.uses < t.max_uses)
         ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
        [since, now, limit],
      )
      .map(toView);
  }

  revoke(id: number, at: number): void {
    this.db.run('UPDATE enrollment_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [
      at,
      id,
    ]);
  }
}
