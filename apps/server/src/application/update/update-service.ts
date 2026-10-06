/**
 * Update check (FR-001.2): 2 minutes after start and every `update.checkIntervalHours`, the latest
 * release of the compiled-in repository (ADR-025) is compared with the running version. Drafts,
 * prereleases, non-SemVer tags and versions not newer than this one are never offered (AC-001-05).
 * The result survives restarts; a failed check keeps the last good one and says so (AC-001-06).
 */
import type { UpdateCheckStatus, UpdateRelease } from '@uniwake/shared';
import { compareSemver, parseSemver } from '../../domain/semver';
import type { Clock, Logger, ReleaseSource, TimerHandle } from '../ports';
import type { SettingsService } from '../settings/settings-service';

export const INSTALLER_ASSET = 'UniWake-Setup.exe';
export const CHECKSUM_ASSET = 'UniWake-Setup.exe.sha256';
const FIRST_CHECK_MS = 2 * 60_000;
const HOUR = 3_600_000;

/** What a check found; the installer URLs are kept for the download step (M8-T06). */
export interface StoredRelease extends UpdateRelease {
  installer: { url: string; size: number } | null;
  checksumUrl: string | null;
}

export interface UpdateState {
  latest: StoredRelease | null;
  lastCheckAt: number | null;
  lastSuccessAt: number | null;
  error: string | null;
}

export interface UpdateStateStore {
  load(): UpdateState | null;
  save(s: UpdateState): void;
}

export interface UpdateDeps {
  /** null = updates disabled (demo mode, API tests). */
  source: ReleaseSource | null;
  version: string;
  store: UpdateStateStore;
  settings: SettingsService;
  clock: Clock;
  logger: Logger;
}

export const CHECK_FAILED = 'Não foi possível verificar atualizações.';

export class UpdateService {
  private state: UpdateState;
  private timer: TimerHandle | null = null;
  private nextCheckAt: number | null = null;
  private running: Promise<UpdateCheckStatus> | null = null;

  constructor(private readonly d: UpdateDeps) {
    this.state = d.store.load() ?? {
      latest: null,
      lastCheckAt: null,
      lastSuccessAt: null,
      error: null,
    };
  }

  get enabled(): boolean {
    return this.d.source !== null;
  }

  /** The newest offered release when it is newer than this version and installable. */
  pending(): StoredRelease | null {
    const l = this.state.latest;
    const current = parseSemver(this.d.version);
    const latest = l && parseSemver(l.version);
    if (!l || !latest || !current || compareSemver(latest, current) <= 0) return null;
    return l.installer && l.checksumUrl ? l : null;
  }

  status(): UpdateCheckStatus {
    const l = this.state.latest;
    return {
      current: this.d.version,
      enabled: this.enabled,
      mode: this.d.settings.get('update.mode'),
      latest: l
        ? { version: l.version, name: l.name, notes: l.notes, publishedAt: l.publishedAt }
        : null,
      available: this.pending() !== null,
      checking: this.running !== null,
      lastCheckAt: this.state.lastCheckAt,
      lastSuccessAt: this.state.lastSuccessAt,
      nextCheckAt: this.nextCheckAt,
      error: this.state.error,
    };
  }

  start(): void {
    if (!this.enabled) return;
    this.schedule(FIRST_CHECK_MS);
  }

  stop(): void {
    if (this.timer) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
    this.nextCheckAt = null;
  }

  private schedule(ms: number): void {
    if (this.timer) this.d.clock.clearTimeout(this.timer);
    this.nextCheckAt = this.d.clock.now() + ms;
    this.timer = this.d.clock.setTimeout(() => {
      this.timer = null;
      void this.check().finally(() =>
        this.schedule(this.d.settings.get('update.checkIntervalHours') * HOUR),
      );
    }, ms);
  }

  /** Checks now; concurrent calls share one request. */
  check(): Promise<UpdateCheckStatus> {
    if (!this.d.source) return Promise.resolve(this.status());
    this.running ??= this.run(this.d.source).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(source: ReleaseSource): Promise<UpdateCheckStatus> {
    const now = this.d.clock.now();
    try {
      const { release } = await source.latest();
      let latest: StoredRelease | null = null;
      if (release && !release.draft && !release.prerelease && parseSemver(release.tag)) {
        const asset = (name: string) => release.assets.find((a) => a.name === name);
        const installer = asset(INSTALLER_ASSET);
        latest = {
          version: release.version,
          name: release.name,
          notes: release.body.slice(0, 20_000),
          publishedAt: release.publishedAt,
          installer: installer ? { url: installer.url, size: installer.size } : null,
          checksumUrl: asset(CHECKSUM_ASSET)?.url ?? null,
        };
      }
      this.state = { latest, lastCheckAt: now, lastSuccessAt: now, error: null };
    } catch (e) {
      this.d.logger.warn({ err: e }, 'update check failed');
      this.state = { ...this.state, lastCheckAt: now, error: CHECK_FAILED };
    }
    this.d.store.save(this.state);
    return this.status();
  }
}
