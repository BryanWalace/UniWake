/**
 * M22 (FR-403, FR-404, ADR-051): importing a `.uniwake` file — inspect, preview by rollback, merge
 * and replace, secrets, the hub-key rule, the `pre-import` backup and undo, team refusal and
 * standby. Hub A exports, hub B imports.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportInspect, ImportPreview, MigrationState } from '@uniwake/shared';
import { exportCodec } from '../src/adapters/export-codec';
import { ImportService } from '../src/application/migration/import-service';
import { applyImport, hasPreparedMachines, previewImport } from '../src/db/sync/import';
import { SqliteMigrationStateRepo } from '../src/db/repositories/migration-repo';
import { buildApp } from '../src/http/app';
import { registerAgentRoutes } from '../src/http/panel';
import { apiHarness, type ApiHarness, TEST_PASSWORD } from './helpers/api';
import { T0 } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const PASSWORD = 'senha-de-exportacao';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function hub(withBackups = false) {
  const dir = mkdtempSync(join(tmpdir(), 'uniwake-imp-'));
  let restarts = 0;
  const h: ApiHarness = await apiHarness(
    undefined,
    withBackups ? { backupsDir: dir, requestRestart: () => restarts++ } : {},
  );
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => h.close());
  const cookie = await h.as('admin');
  return { h, cookie, restarts: () => restarts };
}

async function source() {
  const a = await hub();
  const s = a.h.services;
  const lab1 = s.rooms.create({ name: 'Lab 1' }, ACTOR);
  s.rooms.create({ name: 'Lab 2' }, ACTOR);
  s.devices.create({ name: 'LAB1-PC01', mac: '00:AA:00:00:00:01', roomId: lab1.id }, ACTOR);
  s.schedules.create(
    {
      name: 'Manhã',
      weekdays: 127,
      timeLocal: '07:00',
      target: { type: 'rooms', roomIds: [lab1.id] },
    },
    ACTOR,
  );
  const exportFile = async (payload: object) =>
    (
      await a.h.inject({
        method: 'POST',
        url: '/api/migration/export',
        cookie: a.cookie,
        payload,
      })
    ).rawPayload;
  return { ...a, exportFile };
}

function client(b: { h: ApiHarness; cookie: string }) {
  return {
    inspect: (bytes: Buffer) =>
      b.h.inject({
        method: 'POST',
        url: '/api/migration/import',
        cookie: b.cookie,
        headers: { 'content-type': 'application/octet-stream' },
        payload: bytes,
      }),
    preview: (id: string, payload: object) =>
      b.h.inject({
        method: 'POST',
        url: `/api/migration/import/${id}/preview`,
        cookie: b.cookie,
        payload,
      }),
    apply: (id: string, payload: object) =>
      b.h.inject({
        method: 'POST',
        url: `/api/migration/import/${id}/apply`,
        cookie: b.cookie,
        payload: { confirm: 'IMPORTAR', ...payload },
      }),
    state: async () =>
      (
        await b.h.inject({ method: 'GET', url: '/api/migration/state', cookie: b.cookie })
      ).json<MigrationState>(),
  };
}

const devices = (h: ApiHarness) =>
  h.services.db.all<{ id: number; name: string }>('SELECT id, name FROM devices ORDER BY id');

const roomNames = (h: ApiHarness) =>
  h.services.rooms
    .list()
    .map((r) => r.name)
    .sort();

describe('inspect (FR-403.1, FR-403.5)', () => {
  it('shows the manifest of a valid file', async () => {
    const a = await source();
    const b = await hub();
    const r = await client(b).inspect(await a.exportFile({ sections: ['inventory'] }));
    expect(r.statusCode).toBe(201);
    const body = r.json<ImportInspect>();
    expect(body.manifest).toMatchObject({ sections: ['inventory'], secrets: false });
    expect(body.blocked).toBeNull();
  });

  it('AC-403-04: a newer format is refused with its version; garbage and edited files too', async () => {
    const b = await hub();
    const c = client(b);
    const newer = gzipSync(
      Buffer.from(
        JSON.stringify({ uniwake: 'export', format: 99, manifest: { appVersion: '2.0.0' } }),
      ),
    );
    const r = await c.inspect(newer);
    expect(r.statusCode).toBe(422);
    expect(r.json<{ message: string }>().message).toBe(
      'Arquivo de uma versão mais nova do UniWake (2.0.0): atualize este PC antes de importar.',
    );
    expect((await c.inspect(Buffer.from('não é gzip'))).json<{ code: string }>().code).toBe(
      'IMPORT_NOT_UNIWAKE',
    );
    const a = await source();
    const json = JSON.parse(
      exportCodec.decompress(await a.exportFile({ sections: ['inventory'] }), 1e7).toString(),
    ) as { data: { inventory: { payload: { name: string } }[] } };
    json.data.inventory[0]!.payload.name = 'Editada';
    const edited = await c.inspect(gzipSync(Buffer.from(JSON.stringify(json))));
    expect(edited.json<{ code: string }>().code).toBe('IMPORT_DAMAGED');
  });
});

describe('preview and apply (FR-403.2, FR-403.3)', () => {
  it('AC-403-01: the preview counts creates, updates, unchanged and conflicts, and changes nothing', async () => {
    const a = await source();
    const b = await hub();
    b.h.services.rooms.create({ name: 'Lab 2' }, ACTOR); // same name, another identity
    b.h.services.rooms.create({ name: 'Sala B' }, ACTOR);
    const c = client(b);
    const { importId } = (
      await c.inspect(await a.exportFile({ sections: ['inventory', 'schedules'] }))
    ).json<ImportInspect>();
    const before = JSON.stringify(b.h.services.db.all('SELECT * FROM rooms ORDER BY id'));
    const p = (await c.preview(importId, { mode: 'merge' })).json<ImportPreview>();
    expect(p.sections.inventory).toEqual({ created: 3, updated: 0, unchanged: 0, ignored: 0 });
    expect(p.sections.schedules).toMatchObject({ created: 1 });
    expect(p.conflicts.map((x) => x.kind)).toContain('duplicate_name');
    expect(p.standby).toBe(true);
    expect(JSON.stringify(b.h.services.db.all('SELECT * FROM rooms ORDER BY id'))).toBe(before);

    // Previewing the same file again after importing it: everything unchanged.
    await c.apply(importId, { mode: 'merge' });
    const again = (
      await c.inspect(await a.exportFile({ sections: ['inventory'] }))
    ).json<ImportInspect>();
    const p2 = (await c.preview(again.importId, { mode: 'merge' })).json<ImportPreview>();
    expect(p2.sections.inventory).toEqual({ created: 0, updated: 0, unchanged: 3, ignored: 0 });
  });

  it('AC-403-02: merge deletes nothing; replace makes the sections equal to the file and keeps machine settings', async () => {
    const a = await source();
    const b = await hub();
    b.h.services.rooms.create({ name: 'Sala B' }, ACTOR);
    b.h.services.db.run(
      "INSERT INTO machine_settings (key, value, updated_at) VALUES ('wake.interfaces', '[\"10.9.9.9\"]', 0)",
    );
    const c = client(b);
    const file = await a.exportFile({ sections: ['inventory', 'schedules'] });

    const merge = (await c.inspect(file)).json<ImportInspect>();
    expect((await c.apply(merge.importId, { mode: 'merge' })).statusCode).toBe(200);
    expect(roomNames(b.h)).toEqual(['Lab 1', 'Lab 2', 'Sala B']);

    const replace = (await c.inspect(file)).json<ImportInspect>();
    const p = (await c.preview(replace.importId, { mode: 'replace' })).json<ImportPreview>();
    expect(p.removed.inventory).toBe(1);
    expect((await c.apply(replace.importId, { mode: 'replace' })).statusCode).toBe(200);
    expect(roomNames(b.h)).toEqual(roomNames(a.h));
    expect(devices(b.h).map((d) => d.name)).toEqual(['LAB1-PC01']);
    expect(b.h.services.db.get('SELECT value FROM machine_settings')).toEqual({
      value: '["10.9.9.9"]',
    });
  });

  it('replace keeps the local id (and so the local history) of a device that is in the file', async () => {
    const a = await source();
    const c = client(a);
    const file = await a.exportFile({ sections: ['inventory', 'schedules'] });
    const id = devices(a.h)[0]!.id;
    a.h.services.db.run("UPDATE device_state SET status = 'online' WHERE device_id = ?", [id]);
    a.h.services.rooms.create({ name: 'Nova depois do backup' }, ACTOR);
    const { importId } = (await c.inspect(file)).json<ImportInspect>();
    expect((await c.apply(importId, { mode: 'replace' })).statusCode).toBe(200);
    expect(devices(a.h)[0]!.id).toBe(id);
    expect(roomNames(a.h)).toEqual(['Lab 1', 'Lab 2']);
  });

  it('replace needs Cadastro and Agendamentos', async () => {
    const a = await source();
    const b = await hub();
    const c = client(b);
    const { importId } = (
      await c.inspect(await a.exportFile({ sections: ['inventory'] }))
    ).json<ImportInspect>();
    const r = await c.preview(importId, { mode: 'replace' });
    expect(r.json<{ code: string }>().code).toBe('IMPORT_REPLACE_INCOMPLETE');
  });
});

describe('secrets and the hub key (FR-402, ADR-051)', () => {
  it('AC-402-01: wrong or missing password changes nothing; the right one brings users and the key', async () => {
    const a = await source();
    await a.h.services.hubKey.ensure();
    const b = await hub();
    await b.h.services.hubKey.ensure();
    const c = client(b);
    const file = await a.exportFile({
      sections: ['inventory', 'schedules', 'users', 'agents'],
      password: PASSWORD,
    });
    const { importId } = (await c.inspect(file)).json<ImportInspect>();
    expect((await c.preview(importId, { mode: 'replace' })).json<{ code: string }>().code).toBe(
      'IMPORT_PASSWORD_REQUIRED',
    );
    const wrong = await c.apply(importId, { mode: 'replace', password: 'outra-senha-aqui' });
    expect(wrong.json<{ message: string }>().message).toBe('Senha incorreta ou arquivo alterado.');
    expect(roomNames(b.h)).toEqual([]);

    // A's admin is "admin-user" with TEST_PASSWORD.
    const ok = await c.apply(importId, { mode: 'replace', password: PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<ImportPreview>().hubKey).toBe('imported');
    expect(b.h.services.hubKey.keyId()).toBe(a.h.services.hubKey.keyId());
    const login = await b.h.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin-user', password: TEST_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('merge keeps this PC key when it already has prepared machines', async () => {
    const a = await source();
    const b = await hub();
    await b.h.services.hubKey.ensure();
    const own = b.h.services.hubKey.keyId();
    const room = b.h.services.rooms.create({ name: 'Sala B' }, ACTOR);
    const dev = b.h.services.devices.create(
      { name: 'B-PC01', mac: '00:BB:00:00:00:01', roomId: room.id },
      ACTOR,
    );
    b.h.services.agentTokens.issue(dev.device.id);
    const c = client(b);
    const { importId } = (
      await c.inspect(await a.exportFile({ sections: ['inventory', 'agents'], password: PASSWORD }))
    ).json<ImportInspect>();
    const p = (
      await c.preview(importId, { mode: 'merge', password: PASSWORD })
    ).json<ImportPreview>();
    expect(p.hubKey).toBe('kept');
    expect(p.notes.join(' ')).toMatch(/chave dele é mantida/);
    await c.apply(importId, { mode: 'merge', password: PASSWORD });
    expect(b.h.services.hubKey.keyId()).toBe(own);
  });
});

describe('backup, undo and standby (FR-403.4, FR-404)', () => {
  it('AC-403-03: a pre-import backup is taken and "Desfazer importação" requests its restore', async () => {
    const a = await source();
    const b = await hub(true);
    const c = client(b);
    const { importId } = (
      await c.inspect(await a.exportFile({ sections: ['inventory', 'schedules'] }))
    ).json<ImportInspect>();
    await c.apply(importId, { mode: 'merge' });
    const kinds = b.h.services.backups!.list().map((x) => x.kind);
    expect(kinds).toContain('pre-import');
    const state = await c.state();
    expect(state.lastImport).toMatchObject({ mode: 'merge' });
    expect(state.lastImport!.backupId).not.toBeNull();
    const undo = await b.h.inject({
      method: 'POST',
      url: '/api/migration/undo',
      cookie: b.cookie,
      payload: { confirm: 'DESFAZER' },
    });
    expect(undo.statusCode).toBe(202);
    expect(b.restarts()).toBe(1);
    const again = await b.h.inject({
      method: 'POST',
      url: '/api/migration/undo',
      cookie: b.cookie,
      payload: { confirm: 'DESFAZER' },
    });
    expect(again.json<{ code: string }>().code).toBe('MIGRATION_UNDO_UNAVAILABLE');
    expect(b.h.services.audit.query({ action: 'migration.import' }).total).toBe(1);
  });

  it('AC-404-01: an imported copy is in standby — schedules skipped, check-ins refused — until activated', async () => {
    const a = await source();
    const b = await hub();
    const agent: FastifyInstance = await buildApp({
      kind: 'agent',
      hosts: 'any',
      bodyLimit: 8 * 1024,
      register: (x) => registerAgentRoutes(x, b.h.services),
    });
    cleanups.push(() => agent.close());
    const c = client(b);
    const { importId } = (
      await c.inspect(await a.exportFile({ sections: ['inventory', 'schedules'] }))
    ).json<ImportInspect>();
    await c.apply(importId, { mode: 'merge' });
    expect((await c.state()).standby).toMatchObject({ by: 'admin-user' });

    const checkin = () =>
      agent.inject({
        method: 'POST',
        url: '/agent/v1/checkin',
        remoteAddress: '10.0.3.41',
        headers: { host: '10.0.3.15:47101', authorization: `Bearer ${'x'.repeat(43)}` },
        payload: {},
      });
    expect((await checkin()).statusCode).toBe(503);

    // The 07:00 schedule comes due (the clock starts at 06:00): skipped while in standby.
    b.h.services.scheduler.tick();
    b.h.clock.set(T0 + 61 * 60_000);
    expect(b.h.services.scheduler.tick().ran).toBe(0);
    expect(b.h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM schedule_runs')!.n).toBe(
      1,
    );

    const activate = await b.h.inject({
      method: 'POST',
      url: '/api/migration/standby/activate',
      cookie: b.cookie,
      payload: { confirm: 'ATIVAR' },
    });
    expect(activate.statusCode).toBe(204);
    expect((await c.state()).standby).toBeNull();
    expect((await checkin()).statusCode).toBe(401); // normal path again: unknown token
    expect(b.h.services.audit.query({ action: 'migration.activate' }).total).toBe(1);
    // Activated: the next morning's run happens again.
    b.h.clock.set(T0 + 86_400_000 + 61 * 60_000);
    expect(b.h.services.scheduler.tick().ran).toBe(1);
  });

  it('AC-403-05: in a team the import is refused (the file is still inspected); export works', async () => {
    const a = await source();
    const b = await hub();
    const db = b.h.services.db;
    const importer = new ImportService({
      codec: exportCodec,
      store: {
        preview: (e, r) => previewImport(db, e, { replace: r, now: 1 }),
        apply: (e, r, after) => applyImport(db, e, { replace: r, now: 1 }, after),
        hasPreparedMachines: () => hasPreparedMachines(db),
      },
      state: new SqliteMigrationStateRepo(db),
      inTeam: () => true,
      hubKey: b.h.services.hubKey,
      backups: null,
      audit: b.h.services.audit,
      clock: b.h.clock,
      logger: b.h.ports.logger,
      newId: () => 'a1b2c3d4-0000-4000-8000-000000000001',
    });
    const file = await a.exportFile({ sections: ['inventory'] });
    const inspected = importer.inspect(file, 'admin');
    expect(inspected.blocked).toMatch(/está numa equipe/);
    await expect(importer.preview(inspected.importId, { mode: 'merge' })).rejects.toMatchObject({
      code: 'IMPORT_IN_TEAM',
    });
    expect(roomNames(b.h)).toEqual([]);
  });
});
