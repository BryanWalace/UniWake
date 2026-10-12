/**
 * M21-T01 (FR-401.2/3, FR-403.5, ADR-049): the `.uniwake` document — sections, canonical checksum,
 * format versions and file names.
 */
import { describe, expect, it } from 'vitest';
import { EXPORT_SECTION_INFO, EXPORT_SECTIONS, exportRequestSchema } from '@uniwake/shared';
import {
  canonicalJson,
  documentChecksum,
  EXPORT_FILE_PATTERN,
  EXPORT_FORMAT,
  type ExportDocument,
  exportFileName,
  readDocument,
  SECTION_ENTITIES,
  sectionOf,
} from '../src/application/migration/document';

function doc(over: Partial<ExportDocument> = {}): ExportDocument {
  const data = {
    inventory: [
      {
        entity: 'room',
        id: 'a1b2c3d4-0000-4000-8000-000000000001',
        rev: 3,
        instance: 'i-1',
        at: 10,
        payload: { name: 'Lab 1', code: 'LAB1' },
      },
    ],
  };
  const manifest = {
    appVersion: '1.4.0',
    createdAt: 1,
    source: { name: 'PC-TI', instanceId: 'i-1' },
    sections: ['inventory' as const],
    counts: { room: 1 },
    secrets: false,
  };
  return {
    uniwake: 'export',
    format: EXPORT_FORMAT,
    manifest: { ...manifest, checksum: documentChecksum(manifest, data) },
    data,
    secrets: null,
    ...over,
  };
}

describe('sections (FR-401.2)', () => {
  it('every replicated entity but team members belongs to exactly one section', () => {
    const all = Object.values(SECTION_ENTITIES).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('team_member');
    expect(sectionOf('device')).toBe('inventory');
    expect(sectionOf('device_agent')).toBe('agents');
    expect(sectionOf('team_member')).toBeNull();
  });

  it('only Usuários and Desligamento remoto are secret; Histórico is off by default', () => {
    expect(EXPORT_SECTIONS.filter((s) => EXPORT_SECTION_INFO[s].secret)).toEqual([
      'users',
      'agents',
    ]);
    expect(EXPORT_SECTIONS.filter((s) => !EXPORT_SECTION_INFO[s].default)).toEqual(['history']);
  });

  it('AC-401-02: secret sections need a password of at least 10 characters', () => {
    expect(exportRequestSchema.safeParse({ sections: ['inventory'] }).success).toBe(true);
    const noPassword = exportRequestSchema.safeParse({ sections: ['inventory', 'users'] });
    expect(noPassword.success).toBe(false);
    expect(noPassword.error?.issues[0]?.message).toMatch(/só podem ser exportados com senha/);
    const short = exportRequestSchema.safeParse({
      sections: ['users'],
      password: 'curta12345'.slice(0, 9),
    });
    expect(short.error?.issues[0]?.message).toMatch(/pelo menos 10/);
    expect(
      exportRequestSchema.safeParse({ sections: ['users'], password: 'senha-de-teste' }).success,
    ).toBe(true);
    expect(exportRequestSchema.safeParse({ sections: [] }).success).toBe(false);
  });
});

describe('canonical JSON and checksum (ADR-049)', () => {
  it('key order does not change the bytes; undefined members are left out', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}',
    );
    expect(canonicalJson({ a: undefined, b: 'x' })).toBe('{"b":"x"}');
  });

  it('a valid document reads back; one changed value or manifest field is "damaged"', () => {
    const good = doc();
    expect(readDocument(JSON.parse(JSON.stringify(good)))).toEqual({ ok: true, doc: good });
    const edited = JSON.parse(JSON.stringify(good)) as ExportDocument;
    edited.data.inventory![0]!.payload.name = 'Lab 2';
    expect(readDocument(edited)).toEqual({ ok: false, error: { kind: 'damaged' } });
    const sections = JSON.parse(JSON.stringify(good)) as ExportDocument;
    sections.manifest.sections = ['inventory', 'schedules'];
    expect(readDocument(sections)).toEqual({ ok: false, error: { kind: 'damaged' } });
  });

  it('a manifest that claims secrets without a secret part (or the reverse) is damaged', () => {
    const base = doc();
    const m = { ...base.manifest, secrets: true };
    const lying = { ...base, manifest: { ...m, checksum: documentChecksum(m, base.data) } };
    expect(readDocument(lying)).toEqual({ ok: false, error: { kind: 'damaged' } });
  });
});

describe('format versions (FR-403.5)', () => {
  it('AC-403-04: a newer format is refused with its app version', () => {
    const newer = { ...doc(), format: EXPORT_FORMAT + 1, manifest: { appVersion: '9.0.0' } };
    expect(readDocument(newer)).toEqual({
      ok: false,
      error: { kind: 'newer', format: EXPORT_FORMAT + 1, appVersion: '9.0.0' },
    });
  });

  it('older formats go through the converter chain; a missing step is damaged', () => {
    const current = doc();
    const old = { uniwake: 'export', format: EXPORT_FORMAT - 1, legacy: current };
    const converters = { [EXPORT_FORMAT - 1]: (d: Record<string, unknown>) => d.legacy as never };
    expect(readDocument(old, converters)).toEqual({ ok: true, doc: current });
    expect(readDocument(old, {})).toEqual({ ok: false, error: { kind: 'damaged' } });
  });

  it('anything else is not a UniWake file', () => {
    for (const raw of [null, 'x', 42, { uniwake: 'backup' }, []]) {
      expect(readDocument(raw)).toEqual({ ok: false, error: { kind: 'not_uniwake' } });
    }
  });
});

describe('file names (FR-401.1, ADR-052)', () => {
  it('uses a safe PC name and the local day; the rotation pattern matches only these files', () => {
    expect(exportFileName('PC-TI 01 (Sala)', '2026-10-12')).toBe(
      'UniWake-PC-TI-01-Sala-2026-10-12.uniwake',
    );
    expect(exportFileName('..\\..', '2026-10-12')).toBe('UniWake-PC-2026-10-12.uniwake');
    expect(EXPORT_FILE_PATTERN.test('UniWake-PC-TI-2026-10-12.uniwake')).toBe(true);
    expect(EXPORT_FILE_PATTERN.test('relatorio.uniwake')).toBe(false);
    expect(EXPORT_FILE_PATTERN.test('UniWake-PC-2026-10-12.uniwake.tmp')).toBe(false);
  });
});
