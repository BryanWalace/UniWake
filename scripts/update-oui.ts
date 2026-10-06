/**
 * Refreshes the bundled MAC vendor list (FR-101, NFR-05: shipped with releases, never downloaded
 * by the hub). Reads the IEEE MA-L registry CSV and writes `apps/server/data/oui.tsv.gz`:
 * one `AABBCC<TAB>Vendor` line per assignment, sorted, after a `# source …` header.
 *
 *   node scripts/update-oui.ts [--from oui.csv]   (default: download from standards-oui.ieee.org)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { parse } from 'csv-parse/sync';

const root = resolve(import.meta.dirname, '..');
const SOURCE = 'https://standards-oui.ieee.org/oui/oui.csv';

/** IEEE CSV → sorted `prefix\tvendor` lines (MA-L, i.e. 24-bit OUIs, only). */
export function ouiLines(csv: string): string[] {
  const rows = parse<{
    Registry?: string;
    Assignment?: string;
    'Organization Name'?: string;
  }>(csv, { columns: true, skip_empty_lines: true, relax_quotes: true });
  const byPrefix = new Map<string, string>();
  for (const r of rows) {
    const prefix = r.Assignment?.trim().toUpperCase() ?? '';
    const name = r['Organization Name']?.replace(/\s+/g, ' ').trim();
    if (r.Registry === 'MA-L' && /^[0-9A-F]{6}$/.test(prefix) && name) {
      byPrefix.set(prefix, name);
    }
  }
  return [...byPrefix.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, n]) => `${p}\t${n}`);
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { from: { type: 'string' } } });
  const csv = values.from
    ? readFileSync(values.from, 'utf8')
    : await (await fetch(SOURCE, { signal: AbortSignal.timeout(60_000) })).text();
  const lines = ouiLines(csv);
  if (lines.length < 10_000) throw new Error(`only ${lines.length} OUIs: refusing to write`);
  const header = `# source ${SOURCE} ${new Date().toISOString().slice(0, 10)} (${lines.length} MA-L)`;
  const out = join(root, 'apps/server/data/oui.tsv.gz');
  writeFileSync(out, gzipSync(`${header}\n${lines.join('\n')}\n`, { level: 9 }));
  process.stdout.write(`${lines.length} OUIs → ${out}\n`);
}
