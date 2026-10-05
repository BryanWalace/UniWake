import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERROR_DEFS,
  formatErrorMessage,
  helpTopicFor,
  HELP_TOPICS,
  httpStatusFor,
  messageParams,
} from '../src/errors';

const PLANNED_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'HOST_NOT_ALLOWED',
  'ORIGIN_NOT_ALLOWED',
  'SETUP_NOT_ALLOWED',
  'SETUP_ALREADY_DONE',
  'LOGIN_INVALID',
  'LOGIN_THROTTLED',
  'PASSWORD_TOO_WEAK',
  'USER_DISABLED',
  'USERNAME_DUPLICATE',
  'DEVICE_MAC_DUPLICATE',
  'DEVICE_NOT_FOUND',
  'MAC_INVALID',
  'IP_INVALID',
  'ROOM_NAME_DUPLICATE',
  'ROOM_CODE_DUPLICATE',
  'TAG_NAME_DUPLICATE',
  'TARGET_NOT_FOUND',
  'LAST_ADMIN',
  'CSV_INVALID',
  'CSV_TOO_LARGE',
  'CONFIRMATION_REQUIRED',
  'DELETE_CONFIRMATION_REQUIRED',
  'WAKE_ALREADY_RUNNING',
  'WAKE_TARGET_EMPTY',
  'NO_NETWORK_INTERFACE',
  'PAUSE_REASON_REQUIRED',
  'ENROLL_TOKEN_INVALID',
  'ENROLL_TOKEN_EXPIRED',
  'ENROLL_TOKEN_REVOKED',
  'ENROLL_TOKEN_EXHAUSTED',
  'ENROLL_ROOM_MISMATCH',
  'PREPARE_SCRIPT_MISSING',
  'UPDATE_NOT_AVAILABLE',
  'UPDATE_IN_PROGRESS',
  'UPDATE_BLOCKED_BY_SCHEDULE',
  'UPDATE_DISK_SPACE',
  'CHECKSUM_MISMATCH',
  'DOWNLOAD_FAILED',
  'BACKUP_NOT_FOUND',
  'RESTORE_CONFIRMATION_MISMATCH',
  'INTERNAL_ERROR',
];

describe('error catalog (ADR-006, plan §6.6)', () => {
  it('contains exactly the codes listed in plan §6.6', () => {
    expect([...ERROR_CODES].sort()).toEqual([...PLANNED_CODES].sort());
  });

  it('every code has an HTTP error status and a pt-BR message ending in punctuation', () => {
    for (const code of ERROR_CODES) {
      const status = httpStatusFor(code);
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
      const msg = ERROR_DEFS[code].message;
      expect(msg.length, code).toBeGreaterThan(10);
      expect(msg, code).toMatch(/[.!?]$/);
    }
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(
      formatErrorMessage('DEVICE_MAC_DUPLICATE', { mac: 'AA:BB:CC:DD:EE:FF', deviceName: 'PC-01' }),
    ).toBe('O MAC AA:BB:CC:DD:EE:FF já está cadastrado no dispositivo "PC-01".');
    expect(formatErrorMessage('CONFIRMATION_REQUIRED')).toContain('{count}');
    expect(messageParams('DEVICE_MAC_DUPLICATE')).toEqual(['mac', 'deviceName']);
    expect(messageParams('NOT_FOUND')).toEqual([]);
  });

  it('help topics are valid and linked where the operator needs guidance', () => {
    expect(helpTopicFor('NO_NETWORK_INTERFACE')).toBe('vlan-broadcast');
    expect(helpTopicFor('NOT_FOUND')).toBeUndefined();
    for (const code of ERROR_CODES) {
      const topic = helpTopicFor(code);
      if (topic !== undefined) expect(HELP_TOPICS).toContain(topic);
    }
  });
});
