/**
 * The bundled vendor list (`data/oui.tsv.gz`, scripts/update-oui.ts), loaded once on first use.
 * Missing file = no vendor names (discovery still works).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { type OuiTable, parseOuiTable } from '../domain/oui';

export class OuiFile {
  private table: OuiTable | null = null;

  constructor(private readonly path: string | null) {}

  get(): OuiTable {
    if (this.table) return this.table;
    try {
      this.table = this.path
        ? parseOuiTable(gunzipSync(readFileSync(this.path)).toString('utf8'))
        : new Map();
    } catch {
      this.table = new Map();
    }
    return this.table;
  }
}

/** data\oui.tsv.gz next to the bundle (installed) or apps/server/data (source). */
export function resolveOuiPath(bundleDir: string): string | null {
  const candidates = [
    join(bundleDir, 'data', 'oui.tsv.gz'),
    join(bundleDir, '..', 'data', 'oui.tsv.gz'),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}
