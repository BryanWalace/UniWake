import { describe, expect, it } from 'vitest';
import {
  BOM,
  CSV_MAX_ROWS,
  detectDelimiter,
  devicesToCsv,
  neutralizeCell,
  normalizeHeader,
  parseBoolean,
  parseDevicesCsv,
  unneutralizeCell,
} from '../src/domain/csv';

describe('CSV format (FR-002.3)', () => {
  it('maps headers with or without accents, any case, and aliases', () => {
    expect(normalizeHeader('Observações')).toBe('observacoes');
    expect(normalizeHeader(' OBSERVACOES ')).toBe('observacoes');
    expect(normalizeHeader(`${BOM}Nome`)).toBe('nome');
    expect(normalizeHeader('Endereço MAC')).toBe('mac');
    expect(normalizeHeader('Sala')).toBe('sala');
    expect(normalizeHeader('Coluna estranha')).toBeNull();
  });

  it('detects ; or , outside quotes', () => {
    expect(detectDelimiter('nome;mac;sala')).toBe(';');
    expect(detectDelimiter('nome,mac,sala')).toBe(',');
    expect(detectDelimiter('"a;b;c",mac,sala')).toBe(',');
    expect(detectDelimiter(`${BOM}nome;mac`)).toBe(';');
  });

  it('parses Brazilian yes/no values', () => {
    for (const v of ['sim', 'SIM', 's', '1', 'true', '', 'Ativo'])
      expect(parseBoolean(v), v).toBe(true);
    for (const v of ['não', 'nao', 'N', '0', 'false', 'inativo'])
      expect(parseBoolean(v), v).toBe(false);
    expect(parseBoolean('talvez')).toBeNull();
  });

  it('AC-002-09 a ;-separated file with BOM and "Observações" imports the same as a ,-separated one without BOM', () => {
    const semi = `${BOM}Nome;MAC;IP;Hostname;Sala;Tags;Observações;Ativo\r\nPC-01;aa-bb-cc-dd-ee-01;10.0.3.21;LAB3-PC01;Lab 3;professor|Win11;"Mesa 1; janela";sim\r\n`;
    const comma = `nome,mac,ip,hostname,sala,tags,observacoes,ativo\nPC-01,aa-bb-cc-dd-ee-01,10.0.3.21,LAB3-PC01,Lab 3,professor|Win11,"Mesa 1; janela",sim\n`;
    const a = parseDevicesCsv(semi);
    const b = parseDevicesCsv(comma);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.delimiter).toBe(';');
    expect(b.delimiter).toBe(',');
    expect(a.rows).toEqual(b.rows);
    expect(a.rows[0]).toEqual({
      line: 2,
      nome: 'PC-01',
      mac: 'aa-bb-cc-dd-ee-01',
      ip: '10.0.3.21',
      hostname: 'LAB3-PC01',
      sala: 'Lab 3',
      tags: ['professor', 'Win11'],
      observacoes: 'Mesa 1; janela',
      ativo: 'sim',
    });
  });

  it('accepts files with only the required columns and reports unknown columns', () => {
    const r = parseDevicesCsv('mac;nome;Patrimônio\n00:11:22:33:44:55;PC;12345\n');
    expect(r).toMatchObject({ ok: true, ignoredColumns: ['Patrimônio'] });
    if (r.ok)
      expect(r.rows[0]).toMatchObject({ nome: 'PC', mac: '00:11:22:33:44:55', sala: '', tags: [] });
  });

  it('rejects files without nome/mac, empty files, oversized files and broken quoting', () => {
    expect(parseDevicesCsv('ip;sala\n10.0.0.1;Lab\n')).toMatchObject({ ok: false });
    expect(parseDevicesCsv('   ')).toMatchObject({ ok: false });
    const many = `nome;mac\n${'PC;00:11:22:33:44:55\n'.repeat(CSV_MAX_ROWS + 1)}`;
    expect(parseDevicesCsv(many)).toEqual({ ok: false, reason: 'too_large' });
    expect(parseDevicesCsv('nome;mac\n"unterminated;00:11:22:33:44:55\n')).toMatchObject({
      ok: false,
    });
  });

  it('AC-002-11 exported cells starting with = + - @ tab or CR are prefixed with an apostrophe', () => {
    expect(neutralizeCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    for (const v of ['+1', '-1', '@SUM(A1)', '\tx', '\rx']) expect(neutralizeCell(v)).toBe(`'${v}`);
    expect(neutralizeCell('PC-01')).toBe('PC-01');
    const csv = devicesToCsv([
      {
        nome: '=HYPERLINK("http://evil")',
        mac: 'AA:BB:CC:DD:EE:01',
        ip: null,
        hostname: null,
        sala: null,
        tags: [],
        observacoes: '@cmd',
        ativo: true,
      },
    ]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`;'@cmd;`);
  });

  it('AC-002-10 export → import is lossless, including neutralized cells', () => {
    const rows = [
      {
        nome: '=Perigoso',
        mac: 'AA:BB:CC:DD:EE:01',
        ip: '10.0.3.21',
        hostname: 'LAB3-PC01',
        sala: 'Lab 3',
        tags: ['professor', 'manhã'],
        observacoes: 'Linha com ; e "aspas"',
        ativo: false,
      },
      {
        nome: 'PC-02',
        mac: 'AA:BB:CC:DD:EE:02',
        ip: null,
        hostname: null,
        sala: null,
        tags: [],
        observacoes: null,
        ativo: true,
      },
    ];
    const parsed = parseDevicesCsv(devicesToCsv(rows));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.map((r) => ({ ...r, line: 0 }))).toEqual([
      {
        line: 0,
        nome: '=Perigoso',
        mac: 'AA:BB:CC:DD:EE:01',
        ip: '10.0.3.21',
        hostname: 'LAB3-PC01',
        sala: 'Lab 3',
        tags: ['professor', 'manhã'],
        observacoes: 'Linha com ; e "aspas"',
        ativo: 'não',
      },
      {
        line: 0,
        nome: 'PC-02',
        mac: 'AA:BB:CC:DD:EE:02',
        ip: '',
        hostname: '',
        sala: '',
        tags: [],
        observacoes: '',
        ativo: 'sim',
      },
    ]);
    expect(unneutralizeCell("'x")).toBe("'x"); // a plain apostrophe is user data, kept
  });
});
