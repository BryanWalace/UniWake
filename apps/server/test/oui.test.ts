import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OuiFile, resolveOuiPath } from '../src/adapters/oui-file';
import { parseOuiTable, vendorOf } from '../src/domain/oui';

describe('MAC vendor lookup (FR-101, NFR-05)', () => {
  const table = parseOuiTable(
    '# source test\n001A2B\tAyecom Technology Co., Ltd.\n080027\tPCS Systemtechnik GmbH\nbad line\n',
  );

  it('finds the vendor of a canonical MAC and ignores comments and malformed lines', () => {
    expect(vendorOf(table, '08:00:27:AA:BB:CC')).toBe('PCS Systemtechnik GmbH');
    expect(vendorOf(table, '00:1A:2B:00:00:01')).toBe('Ayecom Technology Co., Ltd.');
    expect(vendorOf(table, '00:11:22:33:44:55')).toBeNull();
    expect(table.size).toBe(2);
  });

  it('gives no vendor for locally administered (random/virtual) MACs', () => {
    expect(vendorOf(table, '0A:00:27:AA:BB:CC')).toBeNull();
  });

  it('the bundled list loads from the source tree and knows common NIC vendors', () => {
    const path = resolveOuiPath(join(import.meta.dirname, '..', 'src'));
    expect(path).not.toBeNull();
    const bundled = new OuiFile(path).get();
    expect(bundled.size).toBeGreaterThan(30_000);
    expect(vendorOf(bundled, '08:00:27:00:00:01')).toBe('PCS Systemtechnik GmbH');
    expect(new OuiFile(null).get().size).toBe(0);
    expect(new OuiFile(join(import.meta.dirname, 'nope.gz')).get().size).toBe(0);
  });
});
