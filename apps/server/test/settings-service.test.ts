import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@uniwake/shared';
import { AppError } from '../src/application/errors';
import { SettingsService, type SettingChange } from '../src/application/settings/settings-service';
import { SqliteSettingsRepo } from '../src/db/repositories/settings-repo';
import { FakeClock } from './fakes/fake-clock';
import { T0, testDb } from './helpers/db';

function setup() {
  const db = testDb();
  const clock = new FakeClock(T0);
  const repo = new SqliteSettingsRepo(db);
  return { db, clock, repo, service: new SettingsService(repo, clock) };
}

describe('settings service (constitution §2.4)', () => {
  it('returns defaults when nothing is stored', () => {
    const { service } = setup();
    expect(service.all()).toEqual(DEFAULT_SETTINGS);
    expect(service.get('wake.confirmThreshold')).toBe(40);
  });

  it('stores changes, reports old/new values, notifies listeners and persists across instances', () => {
    const { service, repo, clock, db } = setup();
    const seen: SettingChange[][] = [];
    const off = service.onChange((changes) => seen.push(changes));
    const changes = service.update({ 'wake.confirmThreshold': 25, 'wake.repeat': 3 }, 1);
    expect(changes).toEqual([{ key: 'wake.confirmThreshold', old: 40, new: 25 }]); // repeat unchanged
    expect(seen).toHaveLength(1);
    expect(new SettingsService(repo, clock).get('wake.confirmThreshold')).toBe(25);
    expect(
      db.get<{ updated_by: number }>(
        "SELECT updated_by FROM settings WHERE key = 'wake.confirmThreshold'",
      )?.updated_by,
    ).toBe(1);
    off();
    service.update({ 'wake.confirmThreshold': 30 }, 1);
    expect(seen).toHaveLength(1);
  });

  it('rejects invalid patches with VALIDATION_FAILED and changes nothing', () => {
    const { service } = setup();
    for (const patch of [
      { 'wake.repeat': 0 },
      { 'unknown.key': 1 },
      { 'scheduler.timezone': 'Mars/Base' },
    ]) {
      try {
        service.update(patch, null);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe('VALIDATION_FAILED');
      }
    }
    expect(service.all()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults for corrupt or out-of-range stored values', () => {
    const { repo, clock } = setup();
    repo.upsert('wake.repeat', '{not json', T0, null);
    repo.upsert('wake.batchSize', '99999', T0, null);
    repo.upsert('legacy.removed', '"x"', T0, null);
    const s = new SettingsService(repo, clock);
    expect(s.get('wake.repeat')).toBe(3);
    expect(s.get('wake.batchSize')).toBe(10);
  });
});
