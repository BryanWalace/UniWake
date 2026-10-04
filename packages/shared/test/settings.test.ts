import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  isSettingKey,
  isValidTimeZone,
  SETTING_DEFS,
  SETTING_KEYS,
  SETTINGS_GROUPS,
  settingsPatchSchema,
  timeOfDaySchema,
} from '../src/settings';

describe('settings registry (NFR-03, spec §9)', () => {
  it('every default is valid against its own schema', () => {
    for (const key of SETTING_KEYS) {
      const def = SETTING_DEFS[key];
      expect(def.schema.safeParse(def.default).success, key).toBe(true);
    }
  });

  it('every key has UI metadata with a known group, a label and an input type', () => {
    for (const key of SETTING_KEYS) {
      const { meta } = SETTING_DEFS[key];
      expect(Object.keys(SETTINGS_GROUPS), key).toContain(meta.group);
      expect(meta.label.length, key).toBeGreaterThan(3);
      expect(meta.input, key).toBeTruthy();
      expect(key.startsWith(`${meta.group}.`), key).toBe(true);
      if (meta.input === 'select') expect(meta.options?.length, key).toBeGreaterThan(1);
    }
  });

  it('numeric metadata bounds match the schema bounds', () => {
    for (const key of SETTING_KEYS) {
      const { meta, schema } = SETTING_DEFS[key];
      if (meta.input !== 'number' || meta.min === undefined || meta.max === undefined) continue;
      expect(schema.safeParse(meta.min).success, `${key} min`).toBe(true);
      expect(schema.safeParse(meta.max).success, `${key} max`).toBe(true);
      expect(schema.safeParse(meta.min - 1).success, `${key} below min`).toBe(false);
      expect(schema.safeParse(meta.max + 1).success, `${key} above max`).toBe(false);
    }
  });

  it('defaults match spec §9', () => {
    expect(DEFAULT_SETTINGS['wake.confirmThreshold']).toBe(40);
    expect(DEFAULT_SETTINGS['wake.ports']).toEqual([9, 7]);
    expect(DEFAULT_SETTINGS['wake.repeat']).toBe(3);
    expect(DEFAULT_SETTINGS['wake.batchSize']).toBe(10);
    expect(DEFAULT_SETTINGS['wake.batchDelaySeconds']).toBe(5);
    expect(DEFAULT_SETTINGS['wake.maxDevicesPerStep']).toBe(30);
    expect(DEFAULT_SETTINGS['wake.verifyIntervalSeconds']).toBe(15);
    expect(DEFAULT_SETTINGS['wake.verifyWindowMinutes']).toBe(5);
    expect(DEFAULT_SETTINGS['monitor.intervalSeconds']).toBe(60);
    expect(DEFAULT_SETTINGS['monitor.concurrency']).toBe(64);
    expect(DEFAULT_SETTINGS['monitor.tcpPorts']).toEqual([135, 445, 3389]);
    expect(DEFAULT_SETTINGS['monitor.offlineAfter']).toBe(2);
    expect(DEFAULT_SETTINGS['scheduler.graceMinutes']).toBe(15);
    expect(DEFAULT_SETTINGS['scheduler.timezone']).toBe('America/Sao_Paulo');
    expect(DEFAULT_SETTINGS['update.mode']).toBe('auto');
    expect(DEFAULT_SETTINGS['update.windowStart']).toBe('03:00');
    expect(DEFAULT_SETTINGS['update.windowEnd']).toBe('05:00');
    expect(DEFAULT_SETTINGS['backup.time']).toBe('02:30');
    expect(DEFAULT_SETTINGS['bootstrap.panelPort']).toBe(47100);
    expect(DEFAULT_SETTINGS['bootstrap.agentPort']).toBe(47101);
  });

  it('patch schema accepts partial valid updates and rejects unknown keys or bad values', () => {
    expect(settingsPatchSchema.safeParse({ 'wake.repeat': 5 }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ 'wake.repeat': 0 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ 'wake.nope': 1 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ 'wake.interfaces': ['10.0.0.1'] }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ 'wake.interfaces': ['10.0.0.300'] }).success).toBe(
      false,
    );
    expect(settingsPatchSchema.safeParse({ 'panel.lanAddress': '' }).success).toBe(true);
  });

  it('validates time-of-day and time zones', () => {
    expect(timeOfDaySchema.safeParse('06:50').success).toBe(true);
    expect(timeOfDaySchema.safeParse('24:00').success).toBe(false);
    expect(timeOfDaySchema.safeParse('6:50').success).toBe(false);
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isSettingKey('wake.repeat')).toBe(true);
    expect(isSettingKey('toString')).toBe(false);
  });
});
