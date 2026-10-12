/**
 * M22-D break-it (tasks §Break-it): crash mid-import, the same import twice, expiry across a clock
 * jump, duplicate MACs, and hand-made files that try to slip users or misplaced items in.
 */
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportInspect, ImportPreview } from '@uniwake/shared';
import { exportCodec } from '../src/adapters/export-codec';
import {
  documentChecksum,
  EXPORT_FORMAT,
  type ExportDocument,
} from '../src/application/migration/document';
import { applyImport } from '../src/db/sync/import';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function hub() {
  const h: ApiHarness = await apiHarness();
  cleanups.push(() => h.close());
  const cookie = await h.as('admin');
  const post = (url: string, payload: object | Buffer) =>
    h.inject({
      method: 'POST',
      url,
      cookie,
      ...(Buffer.isBuffer(payload)
        ? { headers: { 'content-type': 'application/octet-stream' }, payload }
        : { payload }),
    });
  const exportFile = async (payload: object) =>
    (await post('/api/migration/export', payload)).rawPayload;
  const inspect = async (bytes: Buffer) =>
    (await post('/api/migration/import', bytes)).json<ImportInspect>();
  return { h, post, exportFile, inspect };
}

/** Re-signs a hand-edited document so only our own checks can refuse it. */
function forge(doc: ExportDocument): Buffer {
  const { checksum: _c, ...head } = doc.manifest;
  doc.manifest.checksum = documentChecksum(head, doc.data);
  return gzipSync(Buffer.from(JSON.stringify(doc)));
}

describe('M22-D break-it', () => {
  it('a crash in the middle of an import leaves the database as before (NFR-402)', async () => {
    const a = await hub();
    a.h.services.rooms.create({ name: 'Lab 1' }, ACTOR);
    const b = await hub();
    b.h.services.rooms.create({ name: 'Sala B' }, ACTOR);
    const doc = JSON.parse(
      exportCodec.decompress(await a.exportFile({ sections: ['inventory'] }), 1e7).toString(),
    ) as ExportDocument;
    const entries = doc.data.inventory!.map((e) => ({
      seq: 0,
      entity: e.entity as 'room',
      entityId: e.id,
      op: 'upsert' as const,
      rev: e.rev,
      instance: e.instance,
      at: e.at,
      payload: e.payload,
    }));
    const before = JSON.stringify(b.h.services.db.all('SELECT * FROM rooms'));
    expect(() =>
      applyImport(b.h.services.db, entries, { replace: ['inventory'], now: 1 }, () => {
        throw new Error('energia caiu');
      }),
    ).toThrow('energia caiu');
    expect(JSON.stringify(b.h.services.db.all('SELECT * FROM rooms'))).toBe(before);
  });

  it('importing the same file twice changes nothing the second time', async () => {
    const a = await hub();
    a.h.services.rooms.create({ name: 'Lab 1' }, ACTOR);
    const b = await hub();
    const file = await a.exportFile({ sections: ['inventory'] });
    for (let i = 0; i < 2; i++) {
      const { importId } = await b.inspect(file);
      const r = (
        await b.post(`/api/migration/import/${importId}/apply`, {
          mode: 'merge',
          confirm: 'IMPORTAR',
        })
      ).json<ImportPreview>();
      expect(r.sections.inventory).toEqual(
        i === 0
          ? { created: 1, updated: 0, unchanged: 0, ignored: 0 }
          : { created: 0, updated: 0, unchanged: 1, ignored: 0 },
      );
    }
    expect(b.h.services.rooms.list()).toHaveLength(1);
  });

  it('a pending file expires after 15 minutes, also across a clock jump', async () => {
    const a = await hub();
    const b = await hub();
    const { importId } = await b.inspect(await a.exportFile({ sections: ['inventory'] }));
    b.h.clock.set(b.h.clock.now() + 16 * 60_000);
    // A new admin cookie: the old session may have expired with the jump.
    const r = await b.post(`/api/migration/import/${importId}/preview`, { mode: 'merge' });
    expect([401, 404]).toContain(r.statusCode);
    if (r.statusCode === 404) expect(r.json<{ code: string }>().code).toBe('IMPORT_EXPIRED');
    await expect(b.h.services.importer.preview(importId, { mode: 'merge' })).rejects.toMatchObject({
      code: 'IMPORT_EXPIRED',
    });
  });

  it('a device whose MAC this PC already has under another identity is reported, not duplicated', async () => {
    const a = await hub();
    const room = a.h.services.rooms.create({ name: 'Lab 1' }, ACTOR);
    a.h.services.devices.create({ name: 'PC-A', mac: '00:AA:00:00:00:01', roomId: room.id }, ACTOR);
    const b = await hub();
    b.h.services.devices.create({ name: 'PC-B', mac: '00:AA:00:00:00:01' }, ACTOR);
    const { importId } = await b.inspect(await a.exportFile({ sections: ['inventory'] }));
    const p = (
      await b.post(`/api/migration/import/${importId}/apply`, {
        mode: 'merge',
        confirm: 'IMPORTAR',
      })
    ).json<ImportPreview>();
    expect(p.conflicts.map((c) => c.kind)).toContain('duplicate_mac');
    expect(
      b.h.services.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM devices WHERE mac = '00:AA:00:00:00:01'",
      )!.n,
    ).toBe(1);
  });

  it('users or agent records outside the sealed part are never applied (no password, no users)', async () => {
    const a = await hub();
    const b = await hub();
    const doc = JSON.parse(
      exportCodec.decompress(await a.exportFile({ sections: ['inventory'] }), 1e7).toString(),
    ) as ExportDocument;
    expect(doc.format).toBe(EXPORT_FORMAT);
    doc.data.users = [
      {
        entity: 'user',
        id: 'a1b2c3d4-0000-4000-8000-0000000000aa',
        rev: 99,
        instance: 'atacante',
        at: 1,
        payload: { username: 'intruso', role: 'admin', passwordHash: '$argon2id$v=19$x' },
      },
    ];
    // A room placed under "settings" is ignored too: items only count in their own section.
    doc.data.settings = [
      {
        entity: 'room',
        id: 'a1b2c3d4-0000-4000-8000-0000000000bb',
        rev: 1,
        instance: 'x',
        at: 1,
        payload: { name: 'Fora do lugar' },
      },
    ];
    doc.manifest.sections = ['inventory', 'settings', 'users'];
    const { importId } = await b.inspect(forge(doc));
    await b.post(`/api/migration/import/${importId}/apply`, { mode: 'merge', confirm: 'IMPORTAR' });
    expect(b.h.services.db.all("SELECT id FROM users WHERE username = 'intruso'")).toEqual([]);
    expect(b.h.services.rooms.list().map((r) => r.name)).not.toContain('Fora do lugar');
  });
});
