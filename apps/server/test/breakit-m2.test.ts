/** M2-D break-it pass (tasks.md checklist) for devices, rooms, tags and CSV. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceSaveResult } from '@uniwake/shared';
import { Db } from '../src/db/connection';
import { apiHarness } from './helpers/api';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
async function harness() {
  const h = await apiHarness();
  cleanups.push(() => h.close());
  const cookie = await h.as('operator');
  const post = (url: string, payload: unknown) =>
    h.inject({ method: 'POST', url, cookie, payload: payload as object });
  return { h, cookie, post };
}

describe('M2-D: oversized and malformed input on every new endpoint', () => {
  it('rejects over-limit fields with 422 and never stores them', async () => {
    const { h, post } = await harness();
    expect((await post('/api/rooms', { name: 'x'.repeat(65) })).statusCode).toBe(422);
    expect((await post('/api/rooms', { name: 'ok', notes: 'n'.repeat(1001) })).statusCode).toBe(
      422,
    );
    expect((await post('/api/tags', { name: 't'.repeat(33) })).statusCode).toBe(422);
    expect(
      (await post('/api/devices', { name: 'x', mac: '00:11:22:33:44:55', notes: 'n'.repeat(1001) }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await post('/api/devices', {
          name: 'x',
          mac: '00:11:22:33:44:55',
          tagIds: Array.from({ length: 51 }, (_, i) => i + 1),
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post('/api/devices/bulk', {
          action: 'enable',
          deviceIds: Array.from({ length: 2001 }, (_, i) => i + 1),
        })
      ).statusCode,
    ).toBe(422);
    expect((await post('/api/devices', { name: 'x', mac: 42 })).statusCode).toBe(422);
    expect((await post('/api/devices', ['not', 'an', 'object'])).statusCode).toBe(422);
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n).toBe(0);
  });

  it('rejects CSV files over 2 MB or 5000 rows with CSV_TOO_LARGE', async () => {
    const { post } = await harness();
    const rows = Array.from(
      { length: 5001 },
      (_, i) =>
        `PC-${i};02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
    );
    const tooMany = await post('/api/devices/import/preview', {
      csv: `nome;mac\n${rows.join('\n')}`,
    });
    expect(tooMany.statusCode).toBe(413);
    expect(tooMany.json()).toMatchObject({ code: 'CSV_TOO_LARGE' });
    const big = await post('/api/devices/import/preview', {
      csv: `nome;mac\n${'x'.repeat(2.5 * 1024 * 1024)}`,
    });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ code: 'CSV_TOO_LARGE' });
  });

  it('a page number beyond the end returns an empty page, not an error', async () => {
    const { h, cookie } = await harness();
    const r = await h.inject({ url: '/api/devices?page=999', cookie });
    expect(r.json()).toMatchObject({ items: [], total: 0, page: 999 });
  });
});

describe('M2-D: concurrency', () => {
  it('two parallel creates with the same MAC: exactly one wins', async () => {
    const { h, post } = await harness();
    const results = await Promise.all([
      post('/api/devices', { name: 'A', mac: '00:11:22:33:44:55' }),
      post('/api/devices', { name: 'B', mac: '00-11-22-33-44-55' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n).toBe(1);
  });

  it('two parallel imports of the same file never create duplicates', async () => {
    const { h, post } = await harness();
    const csv = 'nome;mac;sala\nA;00:AA:00:00:00:01;Lab X\nB;00:AA:00:00:00:02;Lab X\n';
    const [a, b] = await Promise.all([
      post('/api/devices/import/commit', { csv }),
      post('/api/devices/import/commit', { csv }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n).toBe(2);
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM rooms')?.n).toBe(1);
  });
});

describe('M2-D: text normalization', () => {
  it('room and tag names that differ only in Unicode normalization (NFC vs NFD) are duplicates', async () => {
    const { post } = await harness();
    const nfc = 'Laboratório'.normalize('NFC');
    const nfd = 'Laboratório'.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect((await post('/api/rooms', { name: nfc })).statusCode).toBe(201);
    const dup = await post('/api/rooms', { name: nfd });
    expect(dup.statusCode).toBe(409);
    expect((await post('/api/tags', { name: 'manhã'.normalize('NFD') })).statusCode).toBe(201);
    expect((await post('/api/tags', { name: 'manhã'.normalize('NFC') })).statusCode).toBe(409);
  });

  it('HTML in names is stored as plain text (rendering escapes it; CSP blocks inline handlers)', async () => {
    const { post } = await harness();
    const name = '<img src=x onerror=alert(1)>';
    const r = await post('/api/devices', { name, mac: '00:11:22:33:44:66' });
    expect(r.json<DeviceSaveResult>().device.name).toBe(name);
  });
});

describe('M2-D: crash during a large import', () => {
  it('kill -9 in the middle of CSV imports leaves only whole imports (all-or-nothing)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uniwake-breakit2-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const dbPath = join(dir, 'import.db');
    const src = (p: string) => pathToFileURL(join(import.meta.dirname, '..', 'src', p)).href;
    const helper = pathToFileURL(join(import.meta.dirname, 'helpers', 'ports.ts')).href;
    const script = join(dir, 'importer.ts');
    writeFileSync(
      script,
      `import { Db } from '${src('db/connection.ts')}';
       import { migrate } from '${src('db/migrate.ts')}';
       import { createServices } from '${src('services.ts')}';
       import { SystemClock } from '${src('adapters/system-clock.ts')}';
       import { fakePorts } from '${helper}';
       const db = new Db(${JSON.stringify(dbPath)});
       migrate(db);
       const clock = new SystemClock();
       const s = createServices(db, clock, fakePorts(clock as never));
       const ROWS = 3000;
       console.log('ready');
       for (let batch = 0; ; batch++) {
         const lines = ['nome;mac;sala'];
         for (let i = 0; i < ROWS; i++) {
           const n = batch * ROWS + i;
           const hex = n.toString(16).padStart(8, '0');
           lines.push('PC-' + n + ';02:00:' + hex.slice(0, 2) + ':' + hex.slice(2, 4) + ':' + hex.slice(4, 6) + ':' + hex.slice(6, 8) + ';Lab ' + batch);
         }
         s.csv.commit({ csv: lines.join('\\n') }, { id: null, label: 'teste' });
       }`,
    );
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const started = await Promise.race([
      once(child.stdout, 'data').then(() => true),
      once(child, 'exit').then(() => false),
    ]);
    expect(started, stderr).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    child.kill('SIGKILL');
    await once(child, 'exit');

    const db = new Db(dbPath);
    try {
      expect(
        db.get<{ c: string }>('PRAGMA integrity_check')?.c ?? db.pragma('integrity_check'),
      ).toBe('ok');
      const devices = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n ?? 0;
      const rooms = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM rooms')?.n ?? 0;
      expect(devices % 3000).toBe(0);
      expect(devices / 3000).toBe(rooms);
      const audits = db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'device.import'",
      )?.n;
      expect(audits).toBe(rooms);
    } finally {
      db.close();
    }
  });
});

describe('M2-F2: audit entries are atomic with the change (P4)', () => {
  it('if writing the audit entry fails, the device/room/tag change is rolled back', async () => {
    const { h } = await harness();
    const failingAudit = {
      record: () => {
        throw new Error('disk full');
      },
    };
    const { DevicesService } = await import('../src/application/devices/devices-service');
    const { RoomsService } = await import('../src/application/rooms/rooms-service');
    const { SqliteDevicesRepo } = await import('../src/db/repositories/devices-repo');
    const { SqliteRoomsRepo } = await import('../src/db/repositories/rooms-repo');
    const db = h.services.db;
    const tx = <T>(fn: () => T): T => db.transaction(fn);
    const actor = { id: null, label: 't' };
    const devices = new DevicesService(
      new SqliteDevicesRepo(db),
      failingAudit as never,
      h.clock,
      tx,
    );
    const rooms = new RoomsService(new SqliteRoomsRepo(db), failingAudit as never, h.clock, tx);
    expect(() => devices.create({ name: 'X', mac: '00:11:22:33:44:99' }, actor)).toThrow(
      'disk full',
    );
    expect(() => rooms.create({ name: 'Lab Z' }, actor)).toThrow('disk full');
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n).toBe(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM rooms')?.n).toBe(0);
  });
});
