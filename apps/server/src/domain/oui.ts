/** MAC vendor lookup from the bundled IEEE list (FR-101). Pure. */
export type OuiTable = ReadonlyMap<string, string>;

/** `AABBCC<TAB>Vendor` lines; `#` lines are comments. */
export function parseOuiTable(text: string): OuiTable {
  const table = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab === 6) table.set(line.slice(0, 6), line.slice(7).trim());
  }
  return table;
}

/**
 * Vendor of a canonical `AA:BB:CC:DD:EE:FF` MAC, or null. Locally administered MACs (random
 * Wi-Fi, virtual) have no registered vendor, even when their first bytes match one.
 */
export function vendorOf(table: OuiTable, mac: string): string | null {
  const first = parseInt(mac.slice(0, 2), 16);
  if (Number.isNaN(first) || (first & 0x02) === 0x02) return null;
  return table.get(mac.replace(/:/g, '').slice(0, 6).toUpperCase()) ?? null;
}
