import { describe, expect, it } from 'vitest';
import { SETTING_DEFS, SETTING_KEYS, SETTINGS_GROUPS } from '../src/settings';

const INPUTS = [
  'number',
  'boolean',
  'text',
  'select',
  'time',
  'timezone',
  'number-list',
  'text-list',
];

describe('settings schema ↔ form metadata (FR-016, NFR-03)', () => {
  it('AC-016-01: every key carries what the generated form needs, consistent with its schema', () => {
    for (const key of SETTING_KEYS) {
      const { schema, default: def, meta } = SETTING_DEFS[key];
      expect(meta.label.trim(), key).not.toBe('');
      expect(INPUTS, key).toContain(meta.input);
      expect(Object.keys(SETTINGS_GROUPS), key).toContain(meta.group);
      expect(key.startsWith(`${meta.group}.`), `${key} is in group ${meta.group}`).toBe(true);
      expect(schema.safeParse(def).success, `${key} default`).toBe(true);
      if (meta.input === 'select') {
        expect(meta.options?.length, key).toBeGreaterThan(0);
        for (const o of meta.options!)
          expect(schema.safeParse(o.value).success, `${key} option ${o.value}`).toBe(true);
      }
      if (meta.input === 'boolean') expect(schema.safeParse(!def).success, key).toBe(true);
      if (meta.input === 'number' && meta.min !== undefined && meta.max !== undefined) {
        expect(schema.safeParse(meta.min).success, `${key} min`).toBe(true);
        expect(schema.safeParse(meta.max).success, `${key} max`).toBe(true);
        expect(schema.safeParse(meta.min - 1).success, `${key} below min`).toBe(false);
        expect(schema.safeParse(meta.max + 1).success, `${key} above max`).toBe(false);
      }
      if (meta.storage === 'config') expect(meta.requiresRestart, key).toBe(true);
    }
  });
});
