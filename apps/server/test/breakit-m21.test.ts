/**
 * M21-D break-it (tasks §Break-it): hostile compressed input, odd requests, password edges and
 * exports running at the same time.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { exportCodec } from '../src/adapters/export-codec';
import { type ExportDocument, readDocument } from '../src/application/migration/document';
import { open } from '../src/application/migration/secret-box';
import { apiHarness } from './helpers/api';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function hub() {
  const h = await apiHarness();
  cleanups.push(() => h.close());
  const cookie = await h.as('admin');
  const exportFile = (payload: unknown) =>
    h.inject({ method: 'POST', url: '/api/migration/export', cookie, payload: payload as object });
  return { h, exportFile };
}

describe('M21-D break-it', () => {
  it('a small file that inflates past the limit is stopped (zip bomb); garbage is not gzip', () => {
    const bomb = gzipSync(Buffer.alloc(5 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(10_000);
    expect(() => exportCodec.decompress(bomb, 1024 * 1024)).toThrow();
    expect(() => exportCodec.decompress(Buffer.from('not gzip at all'), 1024)).toThrow();
    expect(exportCodec.decompress(exportCodec.compress(Buffer.from('{}')), 10).toString()).toBe(
      '{}',
    );
  });

  it('malformed requests are refused before any work', async () => {
    const { exportFile } = await hub();
    for (const body of [
      {},
      { sections: 'inventory' },
      { sections: ['tudo'] },
      { sections: ['inventory'], password: 12345678901 },
      { sections: ['users'], password: 'x'.repeat(257) },
    ]) {
      expect((await exportFile(body)).statusCode, JSON.stringify(body)).toBe(422);
    }
  });

  it('an empty hub exports a valid file; repeated sections count once', async () => {
    const { exportFile } = await hub();
    const r = await exportFile({ sections: ['inventory', 'inventory', 'history'] });
    const doc = JSON.parse(gunzipSync(r.rawPayload).toString()) as ExportDocument;
    expect(readDocument(doc).ok).toBe(true);
    expect(doc.manifest.sections).toEqual(['inventory', 'history']);
    expect(doc.data.inventory).toEqual([]);
  });

  it('passwords of 256 characters and with accents/emoji round-trip', async () => {
    const { exportFile } = await hub();
    for (const password of ['á'.repeat(256), 'senha 🔐 ção çõ']) {
      const r = await exportFile({ sections: ['users'], password });
      expect(r.statusCode).toBe(200);
      const doc = JSON.parse(gunzipSync(r.rawPayload).toString()) as ExportDocument;
      await expect(open(doc.secrets!, password, doc.manifest.checksum)).resolves.toBeInstanceOf(
        Buffer,
      );
    }
  });

  it('exports at the same time all finish and are each valid', async () => {
    const { exportFile } = await hub();
    const all = await Promise.all(
      [1, 2, 3].map(() =>
        exportFile({ sections: ['inventory', 'users'], password: 'senha-forte-1' }),
      ),
    );
    for (const r of all) {
      expect(r.statusCode).toBe(200);
      expect(readDocument(JSON.parse(gunzipSync(r.rawPayload).toString())).ok).toBe(true);
    }
  });
});
