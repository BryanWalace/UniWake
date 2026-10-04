/**
 * Authentication core (FR-006.1, constitution §6.2, plan §6.4).
 * Sessions: 32 random bytes (base64url) in the cookie; only SHA-256 stored. Idle and absolute
 * timeouts come from settings. First-run setup only from a loopback socket, race-safe.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Me, Role } from '@uniwake/shared';
import type { AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import { hashPassword, needsRehash, verifyPassword } from './passwords';

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  role: Role;
  enabled: boolean;
  failedLogins: number;
  lastFailedAt: number | null;
  createdAt: number;
  passwordChangedAt: number;
}

export interface UsersRepo {
  count(): number;
  findById(id: number): UserRecord | undefined;
  findByUsername(username: string): UserRecord | undefined;
  create(u: { username: string; passwordHash: string; role: Role; now: number }): number;
  setPasswordHash(id: number, hash: string, now: number, changed: boolean): void;
  recordLoginFailure(id: number, now: number): void;
  resetLoginFailures(id: number): void;
}

export interface SessionRecord {
  idHash: string;
  userId: number;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface SessionsRepo {
  create(s: SessionRecord & { ip: string | null; userAgent: string | null }): void;
  find(idHash: string): SessionRecord | undefined;
  touch(idHash: string, now: number): void;
  delete(idHash: string): void;
  deleteForUser(userId: number, exceptIdHash?: string): number;
  deleteExpired(now: number): number;
}

export interface RequestContext {
  ip: string | null;
  remoteAddress?: string | null;
  userAgent?: string | null;
}

export function isLoopbackAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return a === '::1' || /^127(\.\d{1,3}){3}$/.test(a);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const TOUCH_INTERVAL_MS = 60_000;

export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly users: UsersRepo,
    private readonly sessions: SessionsRepo,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly transaction: <T>(fn: () => T) => T,
  ) {}

  needsSetup(): boolean {
    return this.users.count() === 0;
  }

  async setup(input: { username: string; password: string }, ctx: RequestContext): Promise<Me> {
    if (!isLoopbackAddress(ctx.remoteAddress ?? null)) {
      this.audit.record({
        actor: { id: null, label: input.username },
        action: 'auth.setup',
        result: 'denied',
        sourceIp: ctx.ip,
        details: { reason: 'not_loopback' },
      });
      throw new AppError('SETUP_NOT_ALLOWED');
    }
    if (!this.needsSetup()) throw new AppError('SETUP_ALREADY_DONE');
    const passwordHash = await hashPassword(input.password);
    const now = this.clock.now();
    const id = this.transaction(() => {
      // Re-checked inside the write transaction: concurrent setups cannot both succeed (AC-006-02).
      if (this.users.count() > 0) throw new AppError('SETUP_ALREADY_DONE');
      const created = this.users.create({
        username: input.username,
        passwordHash,
        role: 'admin',
        now,
      });
      // Same transaction as the user (M2-F2): no admin without its audit entry.
      this.audit.record({
        actor: { id: created, label: input.username },
        action: 'auth.setup',
        target: `user:${input.username}`,
        sourceIp: ctx.ip,
      });
      return created;
    });
    return { id, username: input.username, role: 'admin' };
  }

  async login(
    input: { username: string; password: string },
    ctx: RequestContext,
  ): Promise<{ token: string; user: Me; expiresAt: number }> {
    const user = this.users.findByUsername(input.username);
    if (!user) {
      // Equalize timing so response time does not reveal whether the user exists.
      this.dummyHash ??= hashPassword('uniwake-dummy-password');
      await verifyPassword(input.password, await this.dummyHash);
      this.audit.record({
        actor: { id: null, label: input.username },
        action: 'auth.login',
        result: 'denied',
        sourceIp: ctx.ip,
        details: { reason: 'unknown_user' },
      });
      throw new AppError('LOGIN_INVALID');
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    const now = this.clock.now();
    if (!ok) {
      this.users.recordLoginFailure(user.id, now);
      this.audit.record({
        actor: { id: user.id, label: user.username },
        action: 'auth.login',
        result: 'denied',
        sourceIp: ctx.ip,
        details: { reason: 'bad_password' },
      });
      throw new AppError('LOGIN_INVALID');
    }
    if (!user.enabled) {
      this.audit.record({
        actor: { id: user.id, label: user.username },
        action: 'auth.login',
        result: 'denied',
        sourceIp: ctx.ip,
        details: { reason: 'disabled' },
      });
      throw new AppError('USER_DISABLED');
    }
    this.users.resetLoginFailures(user.id);
    if (needsRehash(user.passwordHash)) {
      this.users.setPasswordHash(user.id, await hashPassword(input.password), now, false);
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + this.settings.get('security.sessionAbsoluteDays') * 86_400_000;
    this.sessions.create({
      idHash: sha256(token),
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 256) ?? null,
    });
    this.audit.record({
      actor: { id: user.id, label: user.username },
      action: 'auth.login',
      sourceIp: ctx.ip,
    });
    return { token, user: { id: user.id, username: user.username, role: user.role }, expiresAt };
  }

  /** Resolves a session cookie to the current user, enforcing idle and absolute expiry. */
  authenticate(token: string | undefined): Me | null {
    if (!token || token.length > 128) return null;
    const idHash = sha256(token);
    const s = this.sessions.find(idHash);
    if (!s) return null;
    const now = this.clock.now();
    const idleMs = this.settings.get('security.sessionIdleHours') * 3_600_000;
    if (now >= s.expiresAt || now - s.lastSeenAt > idleMs) {
      this.sessions.delete(idHash);
      return null;
    }
    const user = this.users.findById(s.userId);
    if (!user || !user.enabled) {
      this.sessions.delete(idHash);
      return null;
    }
    if (now - s.lastSeenAt >= TOUCH_INTERVAL_MS) this.sessions.touch(idHash, now);
    return { id: user.id, username: user.username, role: user.role };
  }

  logout(token: string | undefined, ctx: RequestContext): void {
    if (!token) return;
    const idHash = sha256(token);
    const s = this.sessions.find(idHash);
    this.sessions.delete(idHash);
    if (s) {
      const u = this.users.findById(s.userId);
      this.audit.record({
        actor: { id: s.userId, label: u?.username ?? '?' },
        action: 'auth.logout',
        sourceIp: ctx.ip,
      });
    }
  }

  purgeExpiredSessions(): number {
    return this.sessions.deleteExpired(this.clock.now());
  }
}
