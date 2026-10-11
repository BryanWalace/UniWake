/** M16-T04: warning texts (FR-304.1a, owner Q-8) and the "Desligar computadores" settings. */
import { describe, expect, it } from 'vitest';
import {
  AGENDA_DAYS,
  DEFAULT_POSTPONE_MESSAGE,
  DEFAULT_SETTINGS,
  DEFAULT_WARNING_MESSAGE,
  formatWarning,
  LATE_WAKE_MAX_MINUTES,
  LOST_AFTER_MINUTES,
  MANUAL_WARNING_MINUTES,
  SETTING_DEFS,
  settingsPatchSchema,
  shutdownComment,
} from '../src/index';

const templates = { warning: DEFAULT_WARNING_MESSAGE, postpone: DEFAULT_POSTPONE_MESSAGE };

describe('warning text (FR-304.1a)', () => {
  it('fills the time and adds the postpone suffix only while postpones remain', () => {
    expect(formatWarning(templates, '22:40', 2)).toBe(
      'Este computador será desligado às 22:40 pela equipe de TI. Salve seus arquivos: o que não for salvo será perdido. Você pode adiar mais 2 vez(es).',
    );
    expect(formatWarning(templates, '23:10', 0)).toBe(
      'Este computador será desligado às 23:10 pela equipe de TI. Salve seus arquivos: o que não for salvo será perdido.',
    );
  });

  it('the shutdown.exe comment has no suffix and fits its 512-character limit', () => {
    expect(shutdownComment(DEFAULT_WARNING_MESSAGE, '22:40')).not.toContain('adiar');
    expect(shutdownComment(`${'x'.repeat(600)} {hora}`, '22:40')).toHaveLength(512);
  });
});

describe('"Desligar computadores" settings', () => {
  it('defaults follow the owner: 5 min warning, 2 postpones of 15 min, Q-8 texts, team-wide', () => {
    expect(DEFAULT_SETTINGS['power.defaultWarningMinutes']).toBe(5);
    expect(DEFAULT_SETTINGS['power.postponeMax']).toBe(2);
    expect(DEFAULT_SETTINGS['power.postponeMinutes']).toBe(15);
    expect(DEFAULT_SETTINGS['power.warningMessage']).toBe(DEFAULT_WARNING_MESSAGE);
    expect(DEFAULT_SETTINGS['power.postponeMessage']).toBe(DEFAULT_POSTPONE_MESSAGE);
    for (const k of Object.keys(SETTING_DEFS).filter((k) => k.startsWith('power.'))) {
      expect(SETTING_DEFS[k as keyof typeof SETTING_DEFS].meta.scope).toBe('shared');
      expect(SETTING_DEFS[k as keyof typeof SETTING_DEFS].meta.group).toBe('power');
    }
  });

  it('a customized text must keep its placeholder', () => {
    expect(
      settingsPatchSchema.safeParse({ 'power.warningMessage': 'Desliga às {hora}.' }).success,
    ).toBe(true);
    expect(settingsPatchSchema.safeParse({ 'power.warningMessage': 'Vai desligar.' }).success).toBe(
      false,
    );
    expect(
      settingsPatchSchema.safeParse({ 'power.postponeMessage': 'Adie mais {n}.' }).success,
    ).toBe(true);
    expect(settingsPatchSchema.safeParse({ 'power.postponeMessage': 'Adie.' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ 'power.defaultWarningMinutes': 31 }).success).toBe(
      false,
    );
  });

  it('owner-fixed values are constants, not settings', () => {
    expect([
      AGENDA_DAYS,
      LATE_WAKE_MAX_MINUTES,
      LOST_AFTER_MINUTES,
      MANUAL_WARNING_MINUTES,
    ]).toEqual([14, 60, 15, 1]);
    expect(Object.keys(SETTING_DEFS).some((k) => /agenda|lateWake|lost/i.test(k))).toBe(false);
  });
});
