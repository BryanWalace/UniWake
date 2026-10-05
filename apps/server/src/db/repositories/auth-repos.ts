import type { Role } from '@uniwake/shared';
import type {
  SessionRecord,
  SessionsRepo,
  UserRecord,
  UsersRepo,
} from '../../application/auth/auth-service';
import type { Db } from '../connection';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  enabled: number;
  failed_logins: number;
  last_failed_at: number | null;
  created_at: number;
  password_changed_at: number;
}

const toUser = (r: UserRow): UserRecord => ({
  id: r.id,
  username: r.username,
  passwordHash: r.password_hash,
  role: r.role as Role,
  enabled: r.enabled === 1,
  failedLogins: r.failed_logins,
  lastFailedAt: r.last_failed_at,
  createdAt: r.created_at,
  passwordChangedAt: r.password_changed_at,
});

export class SqliteUsersRepo implements UsersRepo {
  constructor(private readonly db: Db) {}

  count(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  }

  findById(id: number): UserRecord | undefined {
    const r = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    return r ? toUser(r) : undefined;
  }

  findByUsername(username: string): UserRecord | undefined {
    const r = this.db.get<UserRow>('SELECT * FROM users WHERE username = ?', [
      username.toLowerCase(),
    ]);
    return r ? toUser(r) : undefined;
  }

  create(u: { username: string; passwordHash: string; role: Role; now: number }): number {
    return this.db.run(
      `INSERT INTO users (username, password_hash, role, created_at, password_changed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [u.username.toLowerCase(), u.passwordHash, u.role, u.now, u.now],
    ).lastInsertRowid;
  }

  list(): UserRecord[] {
    return this.db.all<UserRow>('SELECT * FROM users ORDER BY username').map(toUser);
  }

  setRoleEnabled(id: number, role: Role, enabled: boolean): void {
    this.db.run('UPDATE users SET role = ?, enabled = ? WHERE id = ?', [role, enabled ? 1 : 0, id]);
  }

  enabledAdmins(exceptId?: number): number {
    return (
      this.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND enabled = 1 AND id <> ?",
        [exceptId ?? -1],
      )?.n ?? 0
    );
  }

  setPasswordHash(id: number, hash: string, now: number, changed: boolean): void {
    if (changed) {
      this.db.run('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?', [
        hash,
        now,
        id,
      ]);
    } else {
      // Parameter upgrade (rehash): the password itself did not change.
      this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
    }
  }

  recordLoginFailure(id: number, now: number, windowStart: number): void {
    this.db.run(
      `UPDATE users SET last_failed_at = ?,
         failed_logins = CASE WHEN last_failed_at IS NULL OR last_failed_at < ? THEN 1 ELSE failed_logins + 1 END
       WHERE id = ?`,
      [now, windowStart, id],
    );
  }

  resetLoginFailures(id: number): void {
    this.db.run('UPDATE users SET failed_logins = 0 WHERE id = ?', [id]);
  }
}

interface SessionRow {
  id_hash: string;
  user_id: number;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

export class SqliteSessionsRepo implements SessionsRepo {
  constructor(private readonly db: Db) {}

  create(s: SessionRecord & { ip: string | null; userAgent: string | null }): void {
    this.db.run(
      `INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [s.idHash, s.userId, s.createdAt, s.lastSeenAt, s.expiresAt, s.ip, s.userAgent],
    );
  }

  find(idHash: string): SessionRecord | undefined {
    const r = this.db.get<SessionRow>('SELECT * FROM sessions WHERE id_hash = ?', [idHash]);
    return r
      ? {
          idHash: r.id_hash,
          userId: r.user_id,
          createdAt: r.created_at,
          lastSeenAt: r.last_seen_at,
          expiresAt: r.expires_at,
        }
      : undefined;
  }

  touch(idHash: string, now: number): void {
    this.db.run('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', [now, idHash]);
  }

  delete(idHash: string): void {
    this.db.run('DELETE FROM sessions WHERE id_hash = ?', [idHash]);
  }

  deleteForUser(userId: number, exceptIdHash?: string): number {
    return this.db.run('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?', [
      userId,
      exceptIdHash ?? '',
    ]).changes;
  }

  deleteExpired(now: number): number {
    return this.db.run('DELETE FROM sessions WHERE expires_at <= ?', [now]).changes;
  }
}
