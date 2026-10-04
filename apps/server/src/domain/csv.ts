/**
 * Device CSV format (FR-002.3, ADR-016). Pure: parsing, header mapping, value normalization and
 * formula neutralization. Validation against the device schema happens in the application layer.
 *
 * Columns: nome, mac, ip, hostname, sala, tags, observacoes, ativo. Tags are separated by `|`.
 * Import accepts `,` or `;`, with or without a UTF-8 BOM, headers with or without accents.
 * Export uses `;` and a BOM, which Excel pt-BR opens correctly.
 */
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export const CSV_COLUMNS = [
  'nome',
  'mac',
  'ip',
  'hostname',
  'sala',
  'tags',
  'observacoes',
  'ativo',
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** UTF-8 byte order mark; built from its code point so editors cannot strip or hide it. */
export const BOM = String.fromCharCode(0xfeff);
const LEADING_BOM = new RegExp('^' + BOM);

export const CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_MAX_ROWS = 5000;

const ALIASES: Record<string, CsvColumn> = {
  nome: 'nome',
  name: 'nome',
  mac: 'mac',
  enderecomac: 'mac',
  macaddress: 'mac',
  ip: 'ip',
  enderecoip: 'ip',
  hostname: 'hostname',
  host: 'hostname',
  nomedohost: 'hostname',
  sala: 'sala',
  room: 'sala',
  tags: 'tags',
  etiquetas: 'tags',
  observacoes: 'observacoes',
  observacao: 'observacoes',
  notas: 'observacoes',
  notes: 'observacoes',
  ativo: 'ativo',
  habilitado: 'ativo',
  enabled: 'ativo',
};

export function normalizeHeader(h: string): CsvColumn | null {
  const key = h
    .replace(LEADING_BOM, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return ALIASES[key] ?? null;
}

/** Chooses `;` or `,` by counting them outside quotes in the header line. */
export function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.replace(LEADING_BOM, '').split(/\r?\n/, 1)[0] ?? '';
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ',') commas++;
    else if (!inQuotes && ch === ';') semis++;
  }
  return semis > commas ? ';' : ',';
}

const TRUE_WORDS = new Set(['', 'sim', 's', '1', 'true', 'yes', 'y', 'ativo', 'ativa', 'x']);
const FALSE_WORDS = new Set(['nao', 'n', '0', 'false', 'no', 'inativo', 'inativa', 'desativado']);

/** `null` when the value is not a recognizable yes/no. Empty means "ativo". */
export function parseBoolean(v: string): boolean | null {
  const k = v.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (TRUE_WORDS.has(k)) return true;
  if (FALSE_WORDS.has(k)) return false;
  return null;
}

/** Characters that make spreadsheets evaluate a cell as a formula (CSV injection). */
const RISKY = new Set(['=', '+', '-', '@', '\t', '\r']);

export function neutralizeCell(v: string): string {
  return v.length > 0 && RISKY.has(v[0]!) ? `'${v}` : v;
}

/** Reverses `neutralizeCell` so exports re-import losslessly (AC-002-10). */
export function unneutralizeCell(v: string): string {
  return v.length > 1 && v[0] === "'" && RISKY.has(v[1]!) ? v.slice(1) : v;
}

export interface CsvRow {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  nome: string;
  mac: string;
  ip: string;
  hostname: string;
  sala: string;
  tags: string[];
  observacoes: string;
  ativo: string;
}

export type CsvParseResult =
  | {
      ok: true;
      rows: CsvRow[];
      delimiter: ',' | ';';
      columns: CsvColumn[];
      ignoredColumns: string[];
    }
  | { ok: false; reason: string };

export function parseDevicesCsv(input: string): CsvParseResult {
  if (Buffer.byteLength(input, 'utf8') > CSV_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const text = input.replace(LEADING_BOM, '');
  if (text.trim() === '') return { ok: false, reason: 'arquivo vazio' };
  const delimiter = detectDelimiter(text);
  let records: string[][];
  try {
    records = parse(text, {
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (e) {
    return { ok: false, reason: `formato inválido (${(e as Error).message.split('\n')[0] ?? ''})` };
  }
  const [header, ...data] = records;
  if (!header) return { ok: false, reason: 'arquivo vazio' };
  if (data.length > CSV_MAX_ROWS) return { ok: false, reason: 'too_large' };

  const mapping = header.map(normalizeHeader);
  const ignoredColumns = header.filter((_, i) => mapping[i] === null);
  if (!mapping.includes('nome') || !mapping.includes('mac')) {
    return { ok: false, reason: 'as colunas "nome" e "mac" são obrigatórias' };
  }

  const rows: CsvRow[] = data.map((cells, i) => {
    const get = (col: CsvColumn) => {
      const idx = mapping.indexOf(col);
      return idx >= 0 ? unneutralizeCell(cells[idx] ?? '') : '';
    };
    return {
      line: i + 2,
      nome: get('nome'),
      mac: get('mac'),
      ip: get('ip'),
      hostname: get('hostname'),
      sala: get('sala'),
      tags: get('tags')
        .split('|')
        .map((t) => t.trim())
        .filter(Boolean),
      observacoes: get('observacoes'),
      ativo: get('ativo'),
    };
  });
  const columns = CSV_COLUMNS.filter((c) => mapping.includes(c));
  return { ok: true, rows, delimiter, columns, ignoredColumns };
}

export interface CsvExportRow {
  nome: string;
  mac: string;
  ip: string | null;
  hostname: string | null;
  sala: string | null;
  tags: string[];
  observacoes: string | null;
  ativo: boolean;
}

/** `;`-separated UTF-8 with BOM; every text cell neutralized (AC-002-11). */
export function devicesToCsv(rows: readonly CsvExportRow[]): string {
  const body = stringify(
    rows.map((r) =>
      [
        r.nome,
        r.mac,
        r.ip ?? '',
        r.hostname ?? '',
        r.sala ?? '',
        r.tags.join('|'),
        r.observacoes ?? '',
        r.ativo ? 'sim' : 'não',
      ].map(neutralizeCell),
    ),
    { delimiter: ';', record_delimiter: '\r\n' },
  );
  return `${BOM}${CSV_COLUMNS.join(';')}\r\n${body}`;
}
