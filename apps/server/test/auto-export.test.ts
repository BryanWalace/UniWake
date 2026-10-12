/**
 * M23-T03 (FR-405, ADR-052): daily automatic export to a folder — the file, rotation of this PC's
 * files only, failures in "Saúde do sistema", and the timer.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { exportFolderSchema } from '@uniwake/shared';
import type { ExportDocument } from '../src/application/migration/document';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0 } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const DAY = 86_400_000;
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function setup(keep = 14) {
  const dir = mkdtempSync(join(tmpdir(), 'uniwake-auto-'));
  const h: ApiHarness = await apiHarness(undefined, {
    team: { port: 0, defaultPort: 0, machineName: 'PC-TI' },
  });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => h.close());
  h.services.rooms.create({ name: 'Lab 1' }, ACTOR);
  h.services.settings.update(
    { 'export.autoEnabled': true, 'export.autoFolder': dir, 'export.autoKeep': keep },
    null,
  );
  return { h, dir };
}

describe('automatic export (FR-405)', () => {
  it('AC-405-01: writes a file without secrets to the folder', async () => {
    const { h, dir } = await setup();
    const r = await h.services.autoExport.runOnce();
    expect(r).toMatchObject({ ok: true, file: 'UniWake-PC-TI-2026-10-05.uniwake' });
    const files = readdirSync(dir);
    expect(files).toEqual(['UniWake-PC-TI-2026-10-05.uniwake']);
    const doc = JSON.parse(
      gunzipSync(readFileSync(join(dir, files[0]!))).toString(),
    ) as ExportDocument;
    expect(doc.manifest.sections).toEqual(['inventory', 'schedules', 'settings']);
    expect(doc.secrets).toBeNull();
    expect(h.services.importer.state().lastAutoExport).toMatchObject({ ok: true });
  });

  it('AC-405-01: keeps only the newest N of this PC and never touches other files', async () => {
    const { h, dir } = await setup(2);
    writeFileSync(join(dir, 'UniWake-OUTRO-PC-2026-01-01.uniwake'), 'x');
    writeFileSync(join(dir, 'planilha.xlsx'), 'x');
    for (let i = 0; i < 3; i++) {
      h.clock.set(T0 + i * DAY);
      await h.services.autoExport.runOnce();
    }
    expect(readdirSync(dir).sort()).toEqual([
      'UniWake-OUTRO-PC-2026-01-01.uniwake',
      'UniWake-PC-TI-2026-10-06.uniwake',
      'UniWake-PC-TI-2026-10-07.uniwake',
      'planilha.xlsx',
    ]);
  });

  it('AC-405-01: a missing folder is a warning in "Saúde do sistema" until the next success', async () => {
    const { h, dir } = await setup();
    h.services.settings.update({ 'export.autoFolder': join(dir, 'nao-existe') }, null);
    expect((await h.services.autoExport.runOnce())!.ok).toBe(false);
    const warn = h.services.health.details().warnings.find((w) => w.code === 'auto_export_failed');
    expect(warn?.message).toMatch(/A exportação automática falhou/);
    h.services.settings.update({ 'export.autoFolder': dir }, null);
    await h.services.autoExport.runOnce();
    expect(h.services.health.details().warnings.map((w) => w.code)).not.toContain(
      'auto_export_failed',
    );
  });

  it('does nothing when off or without a folder', async () => {
    const { h, dir } = await setup();
    h.services.settings.update({ 'export.autoEnabled': false }, null);
    expect(await h.services.autoExport.runOnce()).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('runs at export.autoTime through the timer (02:45 local)', async () => {
    const { h, dir } = await setup();
    h.services.autoExport.start();
    cleanups.push(() => h.services.autoExport.stop());
    h.clock.advance(20 * 3_600_000 + 44 * 60_000); // 06:00 → 02:44 next day
    expect(readdirSync(dir)).toEqual([]);
    h.clock.advance(2 * 60_000);
    await new Promise((r) => setTimeout(r, 50)); // the export itself is async
    expect(existsSync(join(dir, 'UniWake-PC-TI-2026-10-06.uniwake'))).toBe(true);
  });

  it('the folder setting takes local folders and shares, nothing else', () => {
    for (const ok of ['', 'D:\\UniWake-exportacoes', '\\\\servidor\\pasta', '\\\\srv\\c$\\a b'])
      expect(exportFolderSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['pasta', 'D:', '\\\\servidor', 'D:\\a|b', 'C:\\a\u0001b', 'http://x'])
      expect(exportFolderSchema.safeParse(bad).success, bad).toBe(false);
  });
});
