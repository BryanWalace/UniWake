import { describe, expect, it } from 'vitest';
import {
  colorSchema,
  deviceBulkSchema,
  deviceCreateSchema,
  deviceListQuerySchema,
  hostnameSchema,
  loginSchema,
  nameSchema,
  notesSchema,
  optionalIpv4Schema,
  paginationSchema,
  passwordSchema,
  roomCodeSchema,
  roomCreateSchema,
  tagNameSchema,
  usernameSchema,
} from '../src/schemas';

const ok = (r: { success: boolean }) => expect(r.success).toBe(true);
const bad = (r: { success: boolean }) => expect(r.success).toBe(false);

describe('field limits (spec §8, ADR-016)', () => {
  it('names: 1..64 chars, trimmed', () => {
    ok(nameSchema.safeParse('a'.repeat(64)));
    bad(nameSchema.safeParse('a'.repeat(65)));
    bad(nameSchema.safeParse('   '));
    expect(nameSchema.parse('  Lab 3  ')).toBe('Lab 3');
  });

  it('tag names: 1..32 chars', () => {
    ok(tagNameSchema.safeParse('t'.repeat(32)));
    bad(tagNameSchema.safeParse('t'.repeat(33)));
  });

  it('notes: ≤ 1000 chars, empty → null', () => {
    ok(notesSchema.safeParse('n'.repeat(1000)));
    bad(notesSchema.safeParse('n'.repeat(1001)));
    expect(notesSchema.parse('')).toBeNull();
  });

  it('hostname: ≤ 253 chars, DNS charset (+ underscore), labels ≤ 63', () => {
    ok(hostnameSchema.safeParse('LAB3-PC01'));
    ok(hostnameSchema.safeParse('lab3-pc01.faculdade.local'));
    ok(hostnameSchema.safeParse('PC_ANTIGO'));
    bad(hostnameSchema.safeParse('-bad'));
    bad(hostnameSchema.safeParse('has space'));
    bad(hostnameSchema.safeParse('<script>'));
    bad(hostnameSchema.safeParse(`${'a'.repeat(64)}.local`));
    const long = Array.from({ length: 4 }, () => 'a'.repeat(63)).join('.'); // 255 chars
    bad(hostnameSchema.safeParse(long));
  });

  it('room code: [A-Z0-9-]{2,16}, uppercased', () => {
    expect(roomCodeSchema.parse('lab3')).toBe('LAB3');
    ok(roomCodeSchema.safeParse('BLOCO-A-101'));
    bad(roomCodeSchema.safeParse('X'));
    bad(roomCodeSchema.safeParse('A'.repeat(17)));
    bad(roomCodeSchema.safeParse('LAB 3'));
  });

  it('username: 3..32 [a-z0-9._-], lowercased; password: 10..128', () => {
    expect(usernameSchema.parse(' Ana.Silva ')).toBe('ana.silva');
    bad(usernameSchema.safeParse('ab'));
    bad(usernameSchema.safeParse('a'.repeat(33)));
    bad(usernameSchema.safeParse('ana silva'));
    ok(passwordSchema.safeParse('p'.repeat(10)));
    bad(passwordSchema.safeParse('p'.repeat(9)));
    bad(passwordSchema.safeParse('p'.repeat(129)));
    bad(loginSchema.safeParse({ username: 'x', password: 'p'.repeat(129) }));
  });

  it('IP and color', () => {
    expect(optionalIpv4Schema.parse('')).toBeNull();
    ok(optionalIpv4Schema.safeParse('10.0.3.15'));
    bad(optionalIpv4Schema.safeParse('10.0.3.256'));
    bad(optionalIpv4Schema.safeParse('fe80::1'));
    expect(colorSchema.parse('#AABBCC')).toBe('#aabbcc');
    bad(colorSchema.safeParse('red'));
  });
});

describe('entity schemas', () => {
  it('device create normalizes MAC and empty optionals', () => {
    const d = deviceCreateSchema.parse({
      name: ' PC-01 ',
      mac: 'aa-bb-cc-dd-ee-f0',
      ip: '',
      hostname: '',
      notes: '',
    });
    expect(d).toMatchObject({ name: 'PC-01', mac: 'AA:BB:CC:DD:EE:F0', ip: null, hostname: null });
    bad(deviceCreateSchema.safeParse({ name: 'x', mac: 'zz' }));
  });

  it('room create accepts optional fields and validates stagger bounds', () => {
    ok(roomCreateSchema.safeParse({ name: 'Lab 3' }));
    ok(roomCreateSchema.safeParse({ name: 'Lab 3', batchSize: 5, batchDelaySeconds: 10 }));
    bad(roomCreateSchema.safeParse({ name: 'Lab 3', batchSize: 0 }));
    bad(roomCreateSchema.safeParse({ name: 'Lab 3', directedBroadcast: 'x' }));
  });

  it('device list query: filters, compact list flag and page size cap', () => {
    expect(deviceListQuerySchema.parse({ roomId: 'none' }).roomId).toBe('none');
    expect(deviceListQuerySchema.parse({ roomId: '3', all: '1' })).toMatchObject({
      roomId: 3,
      all: true,
    });
    bad(deviceListQuerySchema.safeParse({ pageSize: '201' }));
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 50 });
  });

  it('bulk schema discriminates actions', () => {
    ok(deviceBulkSchema.safeParse({ action: 'move', deviceIds: [1, 2], roomId: null }));
    ok(deviceBulkSchema.safeParse({ action: 'addTags', deviceIds: [1], tagIds: [3] }));
    bad(deviceBulkSchema.safeParse({ action: 'addTags', deviceIds: [1] }));
    bad(deviceBulkSchema.safeParse({ action: 'delete', deviceIds: [] }));
    bad(deviceBulkSchema.safeParse({ action: 'delete', deviceIds: [1] }));
    ok(deviceBulkSchema.safeParse({ action: 'delete', deviceIds: [1], confirm: true }));
    bad(deviceBulkSchema.safeParse({ action: 'explode', deviceIds: [1] }));
  });
});
