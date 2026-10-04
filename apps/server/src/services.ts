/**
 * Builds application services over a database and ports. Used by the hub and by API tests, so
 * both run the same wiring.
 */
import { AuditService } from './application/audit/audit-service';
import { AuthService } from './application/auth/auth-service';
import type { Clock } from './application/ports';
import { RoomsService } from './application/rooms/rooms-service';
import { SettingsService } from './application/settings/settings-service';
import type { Db } from './db/connection';
import { SqliteAuditRepo } from './db/repositories/audit-repo';
import { SqliteSessionsRepo, SqliteUsersRepo } from './db/repositories/auth-repos';
import { SqliteRoomsRepo } from './db/repositories/rooms-repo';
import { SqliteSettingsRepo } from './db/repositories/settings-repo';
import type { HttpServices } from './http/context';

export interface Services extends HttpServices {
  db: Db;
  clock: Clock;
}

export function createServices(db: Db, clock: Clock): Services {
  const audit = new AuditService(new SqliteAuditRepo(db), clock);
  const settings = new SettingsService(new SqliteSettingsRepo(db), clock);
  const auth = new AuthService(
    new SqliteUsersRepo(db),
    new SqliteSessionsRepo(db),
    settings,
    audit,
    clock,
    (fn) => db.transaction(fn),
  );
  const tx = <T>(fn: () => T): T => db.transaction(fn);
  const rooms = new RoomsService(new SqliteRoomsRepo(db), audit, clock, tx);
  return { db, clock, audit, settings, auth, rooms };
}
