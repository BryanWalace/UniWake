/**
 * Automatic exports (FR-405, ADR-052): daily at `export.autoTime`, every section that needs no
 * password except Histórico, written to `export.autoFolder` (local or a share); only the newest
 * `export.autoKeep` files of this PC are kept. The last result feeds "Saúde do sistema".
 */
import { EXPORT_SECTION_INFO, EXPORT_SECTIONS, type MigrationState } from '@uniwake/shared';
import { nextLocalTime } from '../../domain/tz';
import type { Clock, Logger, TimerHandle } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import { EXPORT_FILE_PATTERN, exportFileName } from './document';
import type { ExportService } from './export-service';

/** `adapters/export-folder.ts`: atomic writes into a folder that may be a network share. */
export interface ExportFolder {
  /** Writes to a temporary name, then renames, so a half-written file never has the real name. */
  write(folder: string, name: string, bytes: Buffer): void;
  list(folder: string): string[];
  remove(folder: string, name: string): void;
}

export interface AutoExportDeps {
  exporter: Pick<ExportService, 'build'>;
  settings: SettingsService;
  clock: Clock;
  folder: ExportFolder;
  state: { setLastAutoExport(v: MigrationState['lastAutoExport']): void };
  self: () => { name: string };
  logger: Logger;
}

export const AUTO_SECTIONS = EXPORT_SECTIONS.filter(
  (s) => !EXPORT_SECTION_INFO[s].secret && s !== 'history',
);

export class AutoExportService {
  private timer: TimerHandle | null = null;

  constructor(private readonly d: AutoExportDeps) {}

  /** One export now (also the timer's job); null when turned off or without a folder. */
  async runOnce(): Promise<MigrationState['lastAutoExport']> {
    const folder = this.d.settings.get('export.autoFolder');
    if (!this.d.settings.get('export.autoEnabled') || folder === '') return null;
    const at = this.d.clock.now();
    let result: NonNullable<MigrationState['lastAutoExport']>;
    try {
      const file = await this.d.exporter.build({ sections: AUTO_SECTIONS });
      this.d.folder.write(folder, file.fileName, file.bytes);
      this.rotate(folder);
      result = { at, ok: true, file: file.fileName, error: null };
      this.d.logger.info({ file: file.fileName }, 'automatic export written');
    } catch (e) {
      result = { at, ok: false, file: null, error: (e as Error).message.slice(0, 300) };
      this.d.logger.warn({ err: (e as Error).message, folder }, 'automatic export failed');
    }
    this.d.state.setLastAutoExport(result);
    return result;
  }

  /** Keeps the newest files of this PC (names sort by date); never touches anything else. */
  private rotate(folder: string): void {
    const prefix = exportFileName(this.d.self().name, '').replace(/\.uniwake$/, '');
    const mine = this.d.folder
      .list(folder)
      .filter((n) => EXPORT_FILE_PATTERN.test(n) && n.startsWith(prefix))
      .sort()
      .reverse();
    for (const old of mine.slice(this.d.settings.get('export.autoKeep'))) {
      this.d.folder.remove(folder, old);
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.schedule();
  }

  stop(): void {
    if (this.timer !== null) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const now = this.d.clock.now();
    const tz = this.d.settings.get('scheduler.timezone');
    const next = nextLocalTime(now, this.d.settings.get('export.autoTime'), tz);
    this.timer = this.d.clock.setTimeout(() => {
      void this.runOnce().finally(() => {
        this.timer = null;
        this.schedule();
      });
    }, next - now);
  }
}
