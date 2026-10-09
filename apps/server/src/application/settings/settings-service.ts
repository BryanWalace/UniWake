/**
 * Runtime settings (constitution §2.4, NFR-03). Values live in the `settings` table; an absent or
 * no-longer-valid value falls back to the code default. Listeners are notified on change so
 * services apply new values without a restart (M6-T05).
 */
import {
  DEFAULT_SETTINGS,
  isSettingKey,
  SETTING_DEFS,
  SETTING_KEYS,
  type SettingKey,
  type Settings,
  type SettingsPatch,
  settingsPatchSchema,
} from '@uniwake/shared';
import { AppError } from '../errors';
import type { Clock } from '../ports';

export interface SettingsRepo {
  getAll(): { key: string; value: string }[];
  upsert(key: string, valueJson: string, at: number, by: number | null): void;
}

export interface SettingChange {
  key: SettingKey;
  old: unknown;
  new: unknown;
}

export type SettingsListener = (changes: SettingChange[], settings: Settings) => void;

export class SettingsService {
  private current: Settings;
  private listeners: SettingsListener[] = [];

  constructor(
    private readonly repo: SettingsRepo,
    private readonly clock: Clock,
  ) {
    this.current = this.load();
  }

  private load(): Settings {
    const values: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const { key, value } of this.repo.getAll()) {
      if (!isSettingKey(key)) continue;
      try {
        const parsed = SETTING_DEFS[key].schema.safeParse(JSON.parse(value));
        if (parsed.success) values[key] = parsed.data;
      } catch {
        // corrupt JSON → keep default
      }
    }
    return values as Settings;
  }

  /**
   * Re-reads the store after values changed underneath (a sync batch, F7-01) and notifies listeners
   * of what changed, exactly as a local update would.
   */
  reload(): SettingChange[] {
    const next = this.load();
    const changes: SettingChange[] = [];
    for (const key of SETTING_KEYS) {
      if (JSON.stringify(next[key]) !== JSON.stringify(this.current[key])) {
        changes.push({ key, old: this.current[key], new: next[key] });
      }
    }
    this.current = next;
    if (changes.length > 0) for (const l of this.listeners) l(changes, this.all());
    return changes;
  }

  get<K extends SettingKey>(key: K): Settings[K] {
    return this.current[key];
  }

  all(): Settings {
    return { ...this.current };
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Validates and stores a partial update; returns what actually changed. */
  update(patch: unknown, actorId: number | null): SettingChange[] {
    const parsed = settingsPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        {},
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const data: SettingsPatch = parsed.data;
    // R-M1-04: config.json keys are not stored in the DB (M6-T05 routes them to the config file).
    const configKeys = SETTING_KEYS.filter(
      (k) => k in data && SETTING_DEFS[k].meta.storage === 'config',
    );
    if (configKeys.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        {},
        configKeys.map((k) => ({
          path: k,
          message: 'Configurado em config.json (requer reinício).',
        })),
      );
    }
    const changes: SettingChange[] = [];
    const now = this.clock.now();
    for (const key of SETTING_KEYS) {
      if (!(key in data)) continue;
      const value = data[key];
      if (value === undefined) continue;
      if (JSON.stringify(value) === JSON.stringify(this.current[key])) continue;
      changes.push({ key, old: this.current[key], new: value });
      this.repo.upsert(key, JSON.stringify(value), now, actorId);
    }
    if (changes.length > 0) {
      this.current = this.load();
      for (const l of this.listeners) l(changes, this.all());
    }
    return changes;
  }
}
