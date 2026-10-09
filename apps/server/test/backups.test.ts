import { verifyChangeLog } from '../src/db/sync/change-log';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { backupDateLabel } from '../src/application/backups/backup-service';
import { CONFIG_DEFAULTS, type Config, dataPaths } from '../src/config';
import { createHub, type Hub } from '../src/hub';
import { createServices } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const ACTOR = { id: 1, label: 'admin' };
const dirs: string[] = [];
const hubs: Hub[] = [];
const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hubs.splice(0)) await h.stop();
  for (const h of hs.splice(0)) await h.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'uniwake-bkp-'));
  dirs.push(d);
  return d;
};

function world() {
  const db = testDb();
  const clock = new FakeClock(T0);
  const dir = tempDir();
  let restarts = 0;
  const s = createServices(db, clock, fakePorts(clock), {
    backupsDir: dir,
    requestRestart: () => restarts++,
  });
  return { db, clock, dir, s, restarts: () => restarts };
}

describe('backups (FR-014)', () => {
  it('creates consistent copies of the live database, listed with their local date', () => {
    const w = world();
    w.s.rooms.create({ name: 'Lab 1' }, ACTOR);
    const b = w.s.backups!.create('manual', ACTOR);
    expect(existsSync(join(w.dir, b.file))).toBe(true);
    expect(b.size).toBeGreaterThan(0);
    expect(w.s.backups!.list()).toEqual([{ ...b, dateLabel: '05/10/2026' }]);
    expect(backupDateLabel(Date.UTC(2026, 9, 5, 2, 0), 'America/Sao_Paulo')).toBe('04/10/2026');
    w.db.close();
  });

  it('AC-014-01: with 15 daily backups the oldest is deleted (manual ones are kept)', () => {
    const w = world();
    const manual = w.s.backups!.create('manual');
    const daily: { file: string }[] = [];
    for (let i = 0; i < 15; i++) {
      daily.push(w.s.backups!.create('daily'));
      w.clock.advance(86_400_000);
    }
    const kept = w.s.backups!.list().filter((b) => b.kind === 'daily');
    expect(kept).toHaveLength(14);
    expect(kept.some((b) => b.file === daily[0]!.file)).toBe(false);
    expect(existsSync(join(w.dir, daily[0]!.file))).toBe(false);
    expect(existsSync(join(w.dir, manual.file))).toBe(true);
    w.db.close();
  });

  it('runs daily at backup.time and catches up soon after start when the last one is old', async () => {
    const w = world();
    w.s.backups!.start(); // no daily backup yet → within 15 minutes
    await w.clock.advanceAsync(15 * 60_000);
    expect(w.s.backups!.list().filter((b) => b.kind === 'daily')).toHaveLength(1);
    await w.clock.advanceAsync(Date.UTC(2026, 9, 6, 5, 30) - w.clock.now()); // 02:30 local next day
    expect(w.s.backups!.list().filter((b) => b.kind === 'daily')).toHaveLength(2);
    w.s.backups!.stop();
    w.db.close();
  });
});

describe('restore (FR-014)', () => {
  it('AC-014-02: confirms by date, takes a pre-restore backup, audits and restarts; operators get 403', async () => {
    const h = await apiHarness();
    hs.push(h);
    // the harness has no backups dir: attach one for this test
    const dir = tempDir();
    let restarts = 0;
    const s = createServices(h.services.db, h.clock, h.ports, {
      backupsDir: dir,
      requestRestart: () => restarts++,
    });
    h.services.backups = s.backups;
    const b = s.backups!.create('manual');
    const admin = await h.as('admin');
    const restore = (confirm: string, cookie = admin) =>
      h.inject({
        method: 'POST',
        url: `/api/backups/${b.id}/restore`,
        cookie,
        payload: { confirm },
      });

    const wrong = await restore('06/10/2026');
    expect(wrong.json<{ code: string }>().code).toBe('RESTORE_CONFIRMATION_MISMATCH');
    expect((await restore('05/10/2026', await h.as('operator'))).statusCode).toBe(403);
    expect(restarts).toBe(0);

    const ok = await restore('05/10/2026');
    expect(ok.statusCode).toBe(202);
    expect(restarts).toBe(1);
    expect(s.backups!.list().map((x) => x.kind)).toContain('pre-restore');
    expect(readdirSync(dir)).toContain('restore-request.json');
    const audit = h.services.db.get<{ actor_label: string }>(
      "SELECT actor_label FROM audit_log WHERE action = 'backup.restore_requested'",
    );
    expect(audit?.actor_label).toBe('admin-user');
    expect(
      (
        await h.inject({
          method: 'POST',
          url: '/api/backups/999/restore',
          cookie: admin,
          payload: { confirm: 'x' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('a corrupted backup file is refused', () => {
    const w = world();
    const b = w.s.backups!.create('manual');
    writeFileSync(join(w.dir, b.file), 'isto não é um banco SQLite');
    expect(() => w.s.backups!.restore(b.id, '05/10/2026', ACTOR)).toThrow(/corrompido|inválidos/);
    expect(w.restarts()).toBe(0);
    w.db.close();
  });
});

/** Undoes the newest migration (005_team) so the next start has one pending. */
const UNDO_LATEST = [
  'DELETE FROM schema_migrations WHERE version = 5',
  'DROP TABLE team',
  'DROP TABLE team_members',
  'DROP TABLE sync_peers',
  'DROP TABLE sync_conflicts',
].join(';\n');

describe('restore and pre-migration backups on a real hub', () => {
  const silent = pino({ level: 'silent' });
  const config = (dataDir: string): Config => ({
    ...CONFIG_DEFAULTS,
    panelPort: 0,
    agentPort: 0,
    agentBind: '127.0.0.1',
    dataDir,
    demo: false,
  });

  it('the next start swaps the database for the backup and audits the restore (AC-017-08: new identity)', async () => {
    const dir = tempDir();
    let asked = 0;
    const first = await createHub({
      config: config(dir),
      logger: silent,
      requestRestart: () => asked++,
    });
    first.services.rooms.create({ name: 'Antes' }, ACTOR);
    const identity = first.services.health.details().instanceId;
    const b = first.services.backups!.create('manual');
    first.services.rooms.create({ name: 'Depois' }, ACTOR);
    first.services.backups!.restore(b.id, backupDateLabel(b.createdAt, 'America/Sao_Paulo'), ACTOR);
    expect(asked).toBe(1);
    await first.stop();

    const second = await createHub({ config: config(dir), logger: silent });
    hubs.push(second);
    expect(second.services.rooms.list().map((r) => r.name)).toEqual(['Antes']);
    expect(second.services.health.details().instanceId).not.toBe(identity);
    expect(verifyChangeLog(second.db)).toEqual([]);
    expect(second.services.audit.query({ action: 'backup.restore' }).items[0]).toMatchObject({
      actorLabel: 'admin',
      target: `backup:${b.file}`,
    });
    expect(readdirSync(dataPaths(dir).backups).some((f) => f.endsWith('-pre-restore.db'))).toBe(
      true,
    );
    expect(existsSync(join(dataPaths(dir).backups, 'restore-request.json'))).toBe(false);
  });

  it('a migration on an existing database is preceded by a pre-migration backup', async () => {
    const dir = tempDir();
    const first = await createHub({ config: config(dir), logger: silent });
    first.db.exec(UNDO_LATEST);
    await first.stop();
    const second = await createHub({ config: config(dir), logger: silent });
    hubs.push(second);
    expect(second.services.backups!.list().map((b) => b.kind)).toEqual(['pre-migration']);
  });
});
