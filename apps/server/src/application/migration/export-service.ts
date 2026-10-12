/**
 * Export (FR-401, ADR-049/050): the chosen sections as the team-sync snapshots in our change log,
 * secret sections sealed with the password, gzip-compressed. What a peer would receive is exactly
 * what the file carries.
 */
import { EXPORT_SECTION_INFO, type ExportManifest, type ExportSection } from '@uniwake/shared';
import { localDay } from '../../domain/tz';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import type { ChangeEntry } from '../team/replica';
import {
  documentChecksum,
  EXPORT_FORMAT,
  type ExportDocument,
  type ExportedHubKey,
  type ExportEntry,
  exportFileName,
  sectionOf,
  type SecretPayload,
} from './document';
import { seal } from './secret-box';

/** gzip with an inflate limit (ADR-049); `adapters/export-codec.ts`. */
export interface ExportCodec {
  compress(json: Buffer): Buffer;
  /** Throws when the input is not gzip or inflates past `maxBytes`. */
  decompress(bytes: Buffer, maxBytes: number): Buffer;
}

export interface ExportDeps {
  changes: () => readonly ChangeEntry[];
  /** The signing key in clear, only in memory (ADR-050); null when this hub has none. */
  hubKey: () => Promise<ExportedHubKey | null>;
  self: () => { instanceId: string; name: string };
  codec: ExportCodec;
  settings: SettingsService;
  audit: AuditService;
  clock: Clock;
  version: string;
}

export interface ExportFile {
  fileName: string;
  bytes: Buffer;
  manifest: ExportManifest;
}

const toEntry = (c: ChangeEntry): ExportEntry => ({
  entity: c.entity,
  id: c.entityId,
  rev: c.rev,
  instance: c.instance,
  at: c.at,
  payload: c.payload ?? {},
});

export class ExportService {
  constructor(private readonly d: ExportDeps) {}

  async build(
    req: { sections: readonly ExportSection[]; password?: string | undefined },
    actor?: Actor,
  ): Promise<ExportFile> {
    const sections = [...new Set(req.sections)];
    const secret = sections.filter((s) => EXPORT_SECTION_INFO[s].secret);
    if (secret.length > 0 && !req.password) throw new AppError('EXPORT_PASSWORD_REQUIRED');

    const plain: ExportDocument['data'] = {};
    const hidden: SecretPayload['data'] = {};
    const counts: Record<string, number> = {};
    for (const s of sections) (EXPORT_SECTION_INFO[s].secret ? hidden : plain)[s] = [];
    // Tombstones never travel: a merge must not delete anything on the other PC (FR-403.3).
    for (const c of this.d.changes()) {
      if (c.op !== 'upsert' || c.payload === null) continue;
      const s = sectionOf(c.entity);
      if (s === null || !sections.includes(s)) continue;
      (EXPORT_SECTION_INFO[s].secret ? hidden : plain)[s]!.push(toEntry(c));
      counts[c.entity] = (counts[c.entity] ?? 0) + 1;
    }
    const hubKey = sections.includes('agents') ? await this.d.hubKey() : null;

    const now = this.d.clock.now();
    const self = this.d.self();
    const head = {
      appVersion: this.d.version,
      createdAt: now,
      source: { name: self.name, instanceId: self.instanceId },
      sections,
      counts,
      secrets: secret.length > 0,
    };
    const checksum = documentChecksum(head, plain);
    const manifest: ExportManifest = { ...head, checksum };
    const doc: ExportDocument = {
      uniwake: 'export',
      format: EXPORT_FORMAT,
      manifest,
      data: plain,
      secrets:
        secret.length > 0
          ? await seal(
              Buffer.from(JSON.stringify({ data: hidden, hubKey } satisfies SecretPayload)),
              req.password!,
              checksum,
            )
          : null,
    };
    const bytes = this.d.codec.compress(Buffer.from(JSON.stringify(doc), 'utf8'));
    if (actor) {
      // Sections and whether secrets went out; never the password (R11-02).
      this.d.audit.record({
        actor,
        action: 'migration.export',
        target: sections.join(','),
        details: { sections, secrets: manifest.secrets, bytes: bytes.length },
      });
    }
    const day = localDay(now, this.d.settings.get('scheduler.timezone'));
    return { fileName: exportFileName(self.name, day), bytes, manifest };
  }
}
