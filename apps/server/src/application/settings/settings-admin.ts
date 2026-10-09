/**
 * Settings administration (FR-016, NFR-03): reads every key, writes database keys at once (services
 * read them at the moment of use) and bootstrap keys to config.json (applied after a restart).
 * Each save is audited with the old and new values.
 */
import {
  SETTING_DEFS,
  SETTING_KEYS,
  type SettingKey,
  type Settings,
  settingsPatchSchema,
} from '@uniwake/shared';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { SettingChange, SettingsService } from './settings-service';

export interface BootstrapValues {
  panelPort: number;
  agentPort: number;
  syncPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface ConfigFileStore {
  read(): Partial<BootstrapValues>;
  write(values: Partial<BootstrapValues>): void;
}

/** Bootstrap setting key → config.json field. */
const FILE_FIELD: Partial<Record<SettingKey, keyof BootstrapValues>> = {
  'bootstrap.panelPort': 'panelPort',
  'bootstrap.agentPort': 'agentPort',
  'bootstrap.syncPort': 'syncPort',
  'bootstrap.logLevel': 'logLevel',
};

export interface SettingsView {
  values: Settings;
  /** Saved but not in effect until the service restarts. */
  pendingRestart: SettingKey[];
}

export interface SettingsSaveResult {
  changes: { key: SettingKey; old: unknown; new: unknown }[];
  /** Changed keys that only apply after a restart. */
  restartRequired: SettingKey[];
}

export class SettingsAdminService {
  constructor(
    private readonly d: {
      settings: SettingsService;
      audit: AuditService;
      transaction: <T>(fn: () => T) => T;
      /** null in tests/API harness: bootstrap keys are then read-only. */
      configFile: ConfigFileStore | null;
      /** Values the running process started with. */
      running: BootstrapValues;
    },
  ) {}

  private bootstrap(): BootstrapValues {
    return { ...this.d.running, ...(this.d.configFile?.read() ?? {}) };
  }

  view(): SettingsView {
    const file = this.bootstrap();
    const values = this.d.settings.all() as Record<string, unknown>;
    const pendingRestart: SettingKey[] = [];
    for (const [key, field] of Object.entries(FILE_FIELD) as [
      SettingKey,
      keyof BootstrapValues,
    ][]) {
      values[key] = file[field];
      if (file[field] !== this.d.running[field]) pendingRestart.push(key);
    }
    return { values: values as Settings, pendingRestart };
  }

  save(patch: unknown, actor: Actor): SettingsSaveResult {
    const parsed = settingsPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        {},
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const data = parsed.data as Partial<Record<SettingKey, unknown>>;
    const fileKeys = SETTING_KEYS.filter(
      (k) => k in data && SETTING_DEFS[k].meta.storage === 'config',
    );
    const dbPatch = Object.fromEntries(
      Object.entries(data).filter(([k]) => !fileKeys.includes(k as SettingKey)),
    );
    if (fileKeys.length > 0 && !this.d.configFile) {
      throw new AppError(
        'VALIDATION_FAILED',
        {},
        fileKeys.map((k) => ({ path: k, message: 'Não é possível alterar este item aqui.' })),
      );
    }
    return this.d.transaction(() => {
      const changes: SettingChange[] = this.d.settings.update(dbPatch, actor.id);
      const before = this.bootstrap();
      const fileChanges: Partial<BootstrapValues> = {};
      for (const key of fileKeys) {
        const field = FILE_FIELD[key]!;
        if (data[key] === before[field]) continue;
        (fileChanges as Record<string, unknown>)[field] = data[key];
        changes.push({ key, old: before[field], new: data[key] });
      }
      if (Object.keys(fileChanges).length > 0) this.d.configFile!.write(fileChanges);
      if (changes.length > 0) {
        this.d.audit.record({
          actor,
          action: 'settings.update',
          target: 'settings',
          details: { changes: changes.map((c) => ({ key: c.key, old: c.old, new: c.new })) },
        });
      }
      return {
        changes,
        restartRequired: changes
          .map((c) => c.key)
          .filter((k) => SETTING_DEFS[k].meta.requiresRestart === true),
      };
    });
  }
}
