import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isLocallyAdministered, macSchema, macToBytes, parseMac } from '../src/mac';

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Random unicast, non-zero MAC bytes. */
const unicastBytes = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 6, maxLength: 6 })
  .map((b) => [b[0]! & 0xfe, ...b.slice(1)])
  .filter((b) => b.some((x) => x !== 0));

const formats: ((b: number[]) => string)[] = [
  (b) => b.map(hex2).join(':'),
  (b) => b.map(hex2).join('-'),
  (b) => {
    const h = b.map(hex2).join('');
    return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8)}`;
  },
  (b) => b.map(hex2).join(''),
];

describe('MAC parsing (FR-002.1)', () => {
  it('AC-002-01 normalizes aa-bb-cc-dd-ee-ff to AA:BB:CC:DD:EE:FF', () => {
    expect(parseMac('aa-bb-cc-dd-ee-ff')).toEqual({
      ok: true,
      mac: 'AA:BB:CC:DD:EE:FF',
      locallyAdministered: true,
    });
    expect(parseMac('  00:1a:2b:3c:4d:5e ')).toMatchObject({ ok: true, mac: '00:1A:2B:3C:4D:5E' });
    expect(parseMac('001A.2B3C.4D5E')).toMatchObject({ ok: true, mac: '00:1A:2B:3C:4D:5E' });
    expect(parseMac('001a2b3c4d5e')).toMatchObject({ ok: true, mac: '00:1A:2B:3C:4D:5E' });
  });

  it('AC-002-01 property: every accepted format and case normalizes to the same canonical MAC', () => {
    fc.assert(
      fc.property(
        unicastBytes,
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        (bytes, fmt, upper) => {
          const canonical = bytes.map(hex2).join(':').toUpperCase();
          const raw = formats[fmt]!(bytes);
          const r = parseMac(upper ? raw.toUpperCase() : raw);
          expect(r).toMatchObject({ ok: true, mac: canonical });
          // idempotent
          expect(parseMac(canonical)).toMatchObject({ ok: true, mac: canonical });
        },
      ),
    );
  });

  it('AC-002-03 rejects multicast, broadcast and all-zero MACs', () => {
    expect(parseMac('01:00:5E:00:00:01')).toEqual({ ok: false, reason: 'multicast' });
    expect(parseMac('FF:FF:FF:FF:FF:FF')).toEqual({ ok: false, reason: 'multicast' });
    expect(parseMac('00:00:00:00:00:00')).toEqual({ ok: false, reason: 'zero' });
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 6, maxLength: 6 }),
        (b) => {
          const withMulticast = [b[0]! | 0x01, ...b.slice(1)];
          expect(parseMac(withMulticast.map(hex2).join(':'))).toEqual({
            ok: false,
            reason: 'multicast',
          });
        },
      ),
    );
  });

  it('rejects malformed input', () => {
    for (const bad of [
      '',
      'AA:BB:CC:DD:EE',
      'AA:BB:CC:DD:EE:FF:00',
      'AA:BB-CC:DD:EE:FF',
      'GG:BB:CC:DD:EE:FF',
      'AABB.CCDD.EEF',
      'AA BB CC DD EE FF',
    ]) {
      expect(parseMac(bad), bad).toEqual({ ok: false, reason: 'format' });
    }
  });

  it('AC-002-04 flags locally administered MACs (bit 1 of first octet)', () => {
    expect(isLocallyAdministered('02:00:00:00:00:01')).toBe(true);
    expect(isLocallyAdministered('DA:A1:19:00:00:01')).toBe(true);
    expect(isLocallyAdministered('00:1A:2B:3C:4D:5E')).toBe(false);
    expect(isLocallyAdministered('not a mac')).toBe(false);
  });

  it('converts to bytes', () => {
    expect([...macToBytes('01-23-45-67-89-ab'.replace('01', '00'))]).toEqual([
      0x00, 0x23, 0x45, 0x67, 0x89, 0xab,
    ]);
    expect(() => macToBytes('nope')).toThrow();
  });

  it('macSchema outputs the canonical form and a pt-BR message on error', () => {
    expect(macSchema.parse('aabb.ccdd.eeff'.replace('aa', 'a8'))).toBe('A8:BB:CC:DD:EE:FF');
    const r = macSchema.safeParse('xx');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain('MAC inválido');
    expect(macSchema.safeParse('01:00:5E:00:00:01').error?.issues[0]?.message).toContain(
      'multicast',
    );
  });
});
