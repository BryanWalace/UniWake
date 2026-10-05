/**
 * Authentication core (FR-006.1, constitution §6.2, plan §6.4).
 * Sessions: 32 random bytes (base64url) in the cookie; only SHA-256 stored. Idle and absolute
 * timeouts come from settings. First-run setup only from a loopback socket, race-safe.
 */
import { createHash, randomBytes } from 'node:crypto';
import { isWeakPassword } from '../../domain/password-policy';
import { KeyedLimiter } from '../rate-limit';
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
  /** Counts a failure; failures before `windowStart` no longer count (the count restarts). */
  recordLoginFailure(id: number, now: number, windowStart: number): void;
  resetLoginFailures(id: number): void;
  list(): UserRecord[];
  setRoleEnabled(id: number, role: Role, enabled: boolean): void;
  /** Enabled admins, optionally ignoring one user (would they still exist without it?). */
  enabledAdmins(exceptId?: number): number;
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
/** FR-006.3: after 5 failures within 15 min, wait 30 s, doubling per failure, up to 15 min. */
const FAILURE_WINDOW_MS = 15 * 60_000;
const FREE_FAILURES = 5;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;

/** How long this account must still wait before another login attempt (0 = none). */
export function loginBackoffMs(failed: number, lastFailedAt: number | null, now: number): number {
  if (lastFailedAt === null || failed < FREE_FAILURES || now - lastFailedAt > FAILURE_WINDOW_MS) {
    return 0;
  }
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (failed - FREE_FAILURES));
  // M6-F2: after the clock went back, a failure "in the future" cannot be timed: do not block on
  // it (the next failure is stamped with the corrected clock and the backoff resumes from there).
  if (lastFailedAt > now) return 0;
  return Math.max(0, lastFailedAt + delay - now);
}

export class AuthService {
  private dummyHash: Promise<string> | null = null;
  private readonly ipLimiter: KeyedLimiter;

  constructor(
    private readonly users: UsersRepo,
    private readonly sessions: SessionsRepo,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly transaction: <T>(fn: () => T) => T,
  ) {
    this.ipLimiter = new KeyedLimiter(clock, 60_000, () =>
      this.settings.get('security.loginRatePerMinute'),
    );
  }

  /** FR-006.3: length is checked by the schema; this rejects guessable passwords. */
  assertStrongPassword(password: string, username?: string): void {
    if (isWeakPassword(password, username)) throw new AppError('PASSWORD_TOO_WEAK');
  }

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
    this.assertStrongPassword(input.password, input.username);
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
    // Per source IP (FR-006.3): 20 attempts a minute, whatever the account.
    if (!this.ipLimiter.hit(`login:${ctx.ip}`)) throw new AppError('RATE_LIMITED');
    const user = this.users.findByUsername(input.username);
    if (!user) {
      // Equalize timing so response time does not reveal whether the user exists.
      this.dummyHash ??= hashPassword('uniwake-dummy-password');
      await verifyPassword(input.password, await this.dummyHash);
      this.audit.record({
        // R-M6-02: people sometimes type the password into the user field; a value that cannot be
        // a username is not written to the audit log.
        actor: {
          id: null,
          label: /^[a-z0-9._-]{1,32}$/.test(input.username) ? input.username : '(nome inválido)',
        },
        action: 'auth.login',
        result: 'denied',
        sourceIp: ctx.ip,
        details: { reason: 'unknown_user' },
      });
      throw new AppError('LOGIN_INVALID');
    }
    const now = this.clock.now();
    const waitMs = loginBackoffMs(user.failedLogins, user.lastFailedAt, now);
    if (waitMs > 0) {
      // Per account (AC-006-04): refused before the password is even checked, and audited.
      this.audit.record({
        actor: { id: user.id, label: user.username },
        action: 'auth.login',
        result: 'denied',
        sourceIp: ctx.ip,
        details: { reason: 'throttled', waitSeconds: Math.ceil(waitMs / 1000) },
      });
      throw new AppError('LOGIN_THROTTLED', { seconds: Math.ceil(waitMs / 1000) });
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      this.users.recordLoginFailure(user.id, now, now - FAILURE_WINDOW_MS);
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

  /**
   * Resolves a session cookie to the current user, enforcing idle and absolute expiry.
   * `touch: false` checks validity without counting as activity (SSE heartbeats).
   */
  authenticate(token: string | undefined, opts: { touch?: boolean } = {}): Me | null {
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
    if (opts.touch !== false && now - s.lastSeenAt >= TOUCH_INTERVAL_MS) {
      this.sessions.touch(idHash, now);
    }
    return { id: user.id, username: user.username, role: user.role };
  }

  /** AC-006-07: changing one's password revokes every other session of that user. */
  async changePassword(
    userId: number,
    input: { currentPassword: string; newPassword: string },
    currentToken: string | undefined,
    ctx: RequestContext,
  ): Promise<{ revokedSessions: number }> {
    const user = this.users.findById(userId);
    if (!user) throw new AppError('UNAUTHENTICATED');
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new AppError('VALIDATION_FAILED', {}, [
        { path: 'currentPassword', message: 'Senha atual incorreta.' },
      ]);
    }
    if (input.newPassword === input.currentPassword) {
      throw new AppError('VALIDATION_FAILED', {}, [
        { path: 'newPassword', message: 'A nova senha precisa ser diferente da atual.' },
      ]);
    }
    this.assertStrongPassword(input.newPassword, user.username);
    const hash = await hashPassword(input.newPassword);
    return this.transaction(() => {
      this.users.setPasswordHash(user.id, hash, this.clock.now(), true);
      const revokedSessions = this.sessions.deleteForUser(
        user.id,
        currentToken ? sha256(currentToken) : undefined,
      );
      this.audit.record({
        actor: { id: user.id, label: user.username },
        action: 'auth.password_change',
        target: `user:${user.username}`,
        sourceIp: ctx.ip,
        details: { revokedSessions },
      });
      return { revokedSessions };
    });
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
