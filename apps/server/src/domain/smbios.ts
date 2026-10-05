/**
 * SMBIOS placeholder values (FR-007.2, AC-007-12). Many boards ship with vendor template text in
 * manufacturer/model/serial fields; storing it would make every such PC look identical.
 */
const JUNK = new Set(
  [
    'to be filled by o.e.m.',
    'to be filled by oem',
    'default string',
    'system serial number',
    'system product name',
    'system manufacturer',
    'system version',
    'chassis serial number',
    'base board serial number',
    'o.e.m.',
    'oem',
    'not specified',
    'not applicable',
    'n/a',
    'none',
    'invalid',
    'unknown',
    '0',
    '123456789',
  ].map((s) => s.toLowerCase()),
);

/** Trimmed value, or null for empty, placeholder or filler-only text (0000…, XXXX…, ****). */
export function cleanSmbios(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (v === '' || JUNK.has(v.toLowerCase())) return null;
  if (/^([0x*.\- ])\1*$/i.test(v)) return null;
  return v;
}
