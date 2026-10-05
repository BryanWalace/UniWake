/**
 * User management (FR-006.2, admin only). The last enabled admin can never be demoted or disabled,
 * so the panel cannot lock everyone out; disabling a user or resetting their password ends their
 * sessions. Every change is audited in its transaction.
 */
import {
  type User,
  type UserCreate,
  userCreateSchema,
  type UserUpdate,
  userUpdateSchema,
} from '@uniwake/shared';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock } from '../ports';
import type { AuthService, SessionsRepo, UserRecord, UsersRepo } from './auth-service';
import { hashPassword } from './passwords';

export interface UsersDeps {
  users: UsersRepo;
  sessions: SessionsRepo;
  auth: Pick<AuthService, 'assertStrongPassword'>;
  audit: AuditService;
  clock: Clock;
  transaction: <T>(fn: () => T) => T;
}

const view = (u: UserRecord): User => ({
  id: u.id,
  username: u.username,
  role: u.role,
  enabled: u.enabled,
  createdAt: u.createdAt,
  passwordChangedAt: u.passwordChangedAt,
});

export class UsersService {
  constructor(private readonly d: UsersDeps) {}

  list(): User[] {
    return this.d.users.list().map(view);
  }

  private get(id: number): UserRecord {
    const u = this.d.users.findById(id);
    if (!u) throw new AppError('NOT_FOUND');
    return u;
  }

  async create(input: UserCreate, actor: Actor): Promise<User> {
    const data = userCreateSchema.parse(input);
    this.d.auth.assertStrongPassword(data.password, data.username);
    if (this.d.users.findByUsername(data.username)) throw new AppError('USERNAME_DUPLICATE');
    const passwordHash = await hashPassword(data.password);
    const id = this.d.transaction(() => {
      // Re-checked inside the transaction: two concurrent creates cannot both succeed.
      if (this.d.users.findByUsername(data.username)) throw new AppError('USERNAME_DUPLICATE');
      const id = this.d.users.create({
        username: data.username,
        passwordHash,
        role: data.role,
        now: this.d.clock.now(),
      });
      this.d.audit.record({
        actor,
        action: 'user.create',
        target: `user:${data.username}`,
        details: { id, role: data.role },
      });
      return id;
    });
    return view(this.get(id));
  }

  update(id: number, input: UserUpdate, actor: Actor): User {
    return this.d.transaction(() => {
      const patch = userUpdateSchema.parse(input);
      const u = this.get(id);
      const role = patch.role ?? u.role;
      const enabled = patch.enabled ?? u.enabled;
      const losesAdmin = u.role === 'admin' && u.enabled && (role !== 'admin' || !enabled);
      if (losesAdmin && this.d.users.enabledAdmins(id) === 0) throw new AppError('LAST_ADMIN');
      this.d.users.setRoleEnabled(id, role, enabled);
      // A disabled user, or one whose rights shrank, starts over with a fresh login.
      const revoked =
        (!enabled && u.enabled) || (role !== u.role && role === 'operator')
          ? this.d.sessions.deleteForUser(id)
          : 0;
      this.d.audit.record({
        actor,
        action: 'user.update',
        target: `user:${u.username}`,
        details: {
          id,
          role: { from: u.role, to: role },
          enabled: { from: u.enabled, to: enabled },
          revokedSessions: revoked,
        },
      });
      return view(this.get(id));
    });
  }

  async resetPassword(id: number, newPassword: string, actor: Actor): Promise<void> {
    const u = this.get(id);
    this.d.auth.assertStrongPassword(newPassword, u.username);
    const hash = await hashPassword(newPassword);
    this.d.transaction(() => {
      this.d.users.setPasswordHash(id, hash, this.d.clock.now(), true);
      this.d.users.resetLoginFailures(id);
      const revoked = this.d.sessions.deleteForUser(id);
      this.d.audit.record({
        actor,
        action: 'user.reset_password',
        target: `user:${u.username}`,
        details: { id, revokedSessions: revoked },
      });
    });
  }
}
