/**
 * Import (FR-403, FR-404, ADR-051): a `.uniwake` file is checked and kept in memory for 15
 * minutes; the preview runs the import and rolls it back; the real import takes a `pre-import`
 * backup, applies merge or replace in one transaction, may take over the hub key and leaves the PC
 * "em espera" until an administrator activates it.
 */
import {
  EXPORT_SECTION_INFO,
  EXPORT_SECTIONS,
  type ExportSection,
  type ImportInspect,
  type ImportMode,
  type ImportPreview,
  type ImportSectionCounts,
  type MigrationState,
} from '@uniwake/shared';
import type { Actor, AuditService } from '../audit/audit-service';
import type { BackupService } from '../backups/backup-service';
import { AppError } from '../errors';
import type { Clock, Logger } from '../ports';
import type { ApplyResult, ChangeEntry } from '../team/replica';
import {
  type ExportDocument,
  type ExportedHubKey,
  MAX_FILE_BYTES,
  MAX_INFLATED_BYTES,
  readDocument,
  type SecretPayload,
  secretPayloadSchema,
  SECTION_ENTITIES,
  sectionOf,
} from './document';
import type { ExportCodec } from './export-service';
import { open, SecretBoxError } from './secret-box';

const PENDING_MS = 15 * 60_000;
const UNDO_MS = 7 * 86_400_000;
const REPLACE_ALWAYS: readonly ExportSection[] = ['history', 'agents', 'schedules', 'inventory'];

export interface ImportRunResult {
  result: ApplyResult;
  outcome: Map<string, 'created' | 'updated' | 'unchanged' | 'ignored'>;
  removed: Record<string, number>;
}

/** The database side (`db/sync/import.ts`). */
export interface ImportStore {
  preview(entries: readonly ChangeEntry[], replace: readonly string[]): ImportRunResult;
  apply(
    entries: readonly ChangeEntry[],
    replace: readonly string[],
    after: () => void,
  ): ImportRunResult;
  hasPreparedMachines(): boolean;
}

export interface MigrationStateStore {
  standby(): MigrationState['standby'];
  setStandby(v: MigrationState['standby']): void;
  lastImport(): MigrationState['lastImport'];
  setLastImport(v: MigrationState['lastImport']): void;
  lastAutoExport(): MigrationState['lastAutoExport'];
}

export interface ImportDeps {
  codec: ExportCodec;
  store: ImportStore;
  state: MigrationStateStore;
  inTeam: () => boolean;
  hubKey: { importKey(k: ExportedHubKey): Promise<void> };
  backups: BackupService | null;
  audit: AuditService;
  clock: Clock;
  logger: Logger;
  newId: () => string;
}

interface Pending {
  doc: ExportDocument;
  at: number;
  owner: string;
}

interface Resolved {
  entries: ChangeEntry[];
  sections: ExportSection[];
  hubKey: ExportedHubKey | null;
}

const RESOLUTION: Record<string, string> = {
  duplicate_name: 'renomeado para não repetir o nome',
  duplicate_mac: 'mantida a máquina com o mesmo MAC já cadastrada',
  concurrent: 'mantida a versão mais nova',
};

export class ImportService {
  private pending = new Map<string, Pending>();

  constructor(private readonly d: ImportDeps) {}

  /** FR-403.1: checks the file and keeps it for the next steps (one per administrator). */
  inspect(bytes: Buffer, owner: string): ImportInspect {
    if (bytes.length > MAX_FILE_BYTES) throw new AppError('IMPORT_TOO_LARGE');
    let raw: unknown;
    try {
      raw = JSON.parse(this.d.codec.decompress(bytes, MAX_INFLATED_BYTES).toString('utf8'));
    } catch {
      throw new AppError('IMPORT_NOT_UNIWAKE');
    }
    const read = readDocument(raw);
    if (!read.ok) {
      if (read.error.kind === 'newer')
        throw new AppError('IMPORT_NEWER', { version: read.error.appVersion ?? '?' });
      throw new AppError(read.error.kind === 'damaged' ? 'IMPORT_DAMAGED' : 'IMPORT_NOT_UNIWAKE');
    }
    this.sweep();
    for (const [id, p] of this.pending) if (p.owner === owner) this.pending.delete(id);
    const importId = this.d.newId();
    this.pending.set(importId, { doc: read.doc, at: this.d.clock.now(), owner });
    return {
      importId,
      manifest: read.doc.manifest,
      format: read.doc.format,
      blocked: this.d.inTeam() ? new AppError('IMPORT_IN_TEAM').message : null,
    };
  }

  async preview(id: string, req: { mode: ImportMode; password?: string | undefined }) {
    const { doc, resolved, replace } = await this.prepare(id, req);
    const run = this.d.store.preview(resolved.entries, replace);
    return this.describe(doc, resolved, req.mode, run);
  }

  async apply(
    id: string,
    req: { mode: ImportMode; password?: string | undefined },
    actor: Actor,
  ): Promise<ImportPreview> {
    const { doc, resolved, replace } = await this.prepare(id, req);
    const takeKey = this.keyDecision(resolved, req.mode) === 'imported';
    const backup = this.d.backups?.create('pre-import', actor) ?? null;
    const now = this.d.clock.now();
    const standby = resolved.sections.some((s) => s === 'schedules' || s === 'agents');
    const run = this.d.store.apply(resolved.entries, replace, () => {
      if (standby)
        this.d.state.setStandby({ since: now, from: doc.manifest.source.name, by: actor.label });
      this.d.state.setLastImport({
        at: now,
        from: doc.manifest.source.name,
        mode: req.mode,
        backupId: backup?.id ?? null,
        undoUntil: now + UNDO_MS,
      });
    });
    let hubKey: ImportPreview['hubKey'] = takeKey
      ? 'imported'
      : this.keyDecision(resolved, req.mode);
    if (takeKey && resolved.hubKey) {
      try {
        await this.d.hubKey.importKey(resolved.hubKey);
      } catch (e) {
        // The data is in; lab PCs of the other PC will need the preparation command again.
        this.d.logger.warn({ err: (e as Error).message }, 'imported hub key refused');
        hubKey = 'kept';
      }
    }
    this.pending.delete(id);
    this.d.audit.record({
      actor,
      action: 'migration.import',
      target: doc.manifest.source.name,
      details: {
        mode: req.mode,
        sections: resolved.sections,
        from: doc.manifest.source.name,
        createdAt: doc.manifest.createdAt,
        backupId: backup?.id ?? null,
        hubKey,
      },
    });
    return { ...this.describe(doc, resolved, req.mode, run), hubKey };
  }

  state(): MigrationState {
    const lastImport = this.d.state.lastImport();
    return {
      standby: this.d.state.standby(),
      lastImport: lastImport && lastImport.undoUntil > this.d.clock.now() ? lastImport : null,
      lastAutoExport: this.d.state.lastAutoExport(),
    };
  }

  standby(): MigrationState['standby'] {
    return this.d.state.standby();
  }

  /** FR-404: "Ativar este UniWake". */
  activate(actor: Actor): void {
    const s = this.d.state.standby();
    if (!s) return;
    this.d.state.setStandby(null);
    this.d.audit.record({ actor, action: 'migration.activate', target: s.from, details: {} });
  }

  /** FR-403.4: restores the `pre-import` backup through the FR-014 flow (restart). */
  undo(actor: Actor): { restarting: true } {
    const last = this.state().lastImport;
    const backups = this.d.backups;
    const id = last?.backupId ?? null;
    const b = id === null ? undefined : backups?.list().find((x) => x.id === id);
    if (!last || !backups || !b) throw new AppError('MIGRATION_UNDO_UNAVAILABLE');
    this.d.state.setLastImport(null);
    return backups.restore(b.id, b.dateLabel, actor);
  }

  // ------------------------------------------------------------------------------- internals

  private sweep(): void {
    const now = this.d.clock.now();
    for (const [id, p] of this.pending) if (now - p.at > PENDING_MS) this.pending.delete(id);
  }

  private async prepare(id: string, req: { mode: ImportMode; password?: string | undefined }) {
    this.sweep();
    const p = this.pending.get(id);
    if (!p) throw new AppError('IMPORT_EXPIRED');
    if (this.d.inTeam()) throw new AppError('IMPORT_IN_TEAM');
    const resolved = await this.resolve(p.doc, req.password);
    let replace: string[] = [];
    if (req.mode === 'replace') {
      if (!resolved.sections.includes('inventory') || !resolved.sections.includes('schedules'))
        throw new AppError('IMPORT_REPLACE_INCOMPLETE');
      replace = [
        ...REPLACE_ALWAYS,
        ...resolved.sections.filter((s) => s === 'users' || s === 'settings'),
      ];
    }
    return { doc: p.doc, resolved, replace };
  }

  private async resolve(doc: ExportDocument, password: string | undefined): Promise<Resolved> {
    let secret: SecretPayload = { data: {}, hubKey: null };
    if (doc.secrets) {
      if (!password) throw new AppError('IMPORT_PASSWORD_REQUIRED');
      let plain: Buffer;
      try {
        plain = await open(doc.secrets, password, doc.manifest.checksum);
      } catch (e) {
        if (e instanceof SecretBoxError) throw new AppError('IMPORT_BAD_PASSWORD');
        throw e;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(plain.toString('utf8'));
      } catch {
        throw new AppError('IMPORT_DAMAGED');
      }
      const checked = secretPayloadSchema.safeParse(parsed);
      if (!checked.success) throw new AppError('IMPORT_DAMAGED');
      secret = checked.data;
    }
    const entries: ChangeEntry[] = [];
    const sections = new Set<ExportSection>();
    for (const source of [doc.data, secret.data]) {
      for (const s of EXPORT_SECTIONS) {
        const list = source[s];
        if (!list) continue;
        sections.add(s);
        for (const e of list) {
          // An entry outside its section (hand-edited file) is ignored, never applied elsewhere.
          if (sectionOf(e.entity) !== s || !SECTION_ENTITIES[s].includes(e.entity)) continue;
          // A secret section only counts when it came from the sealed part.
          if (EXPORT_SECTION_INFO[s].secret && source === doc.data) continue;
          entries.push({
            seq: 0,
            entity: e.entity as ChangeEntry['entity'],
            entityId: e.id,
            op: 'upsert',
            rev: e.rev,
            instance: e.instance,
            at: e.at,
            payload: e.payload,
          });
        }
      }
    }
    return {
      entries,
      sections: EXPORT_SECTIONS.filter((s) => sections.has(s)),
      hubKey: secret.hubKey,
    };
  }

  private keyDecision(r: Resolved, mode: ImportMode): ImportPreview['hubKey'] {
    if (!r.hubKey) return 'none';
    // ADR-051: never take another key while lab PCs of this PC trust ours (merge keeps them).
    if (mode === 'merge' && this.d.store.hasPreparedMachines()) return 'kept';
    return 'imported';
  }

  private describe(
    doc: ExportDocument,
    r: Resolved,
    mode: ImportMode,
    run: ImportRunResult,
  ): ImportPreview {
    const sections: ImportPreview['sections'] = {};
    for (const s of r.sections) sections[s] = { created: 0, updated: 0, unchanged: 0, ignored: 0 };
    for (const e of r.entries) {
      const s = sectionOf(e.entity);
      const c = run.outcome.get(`${e.entity}:${e.entityId}`);
      if (s && c) (sections[s] as ImportSectionCounts)[c] += 1;
    }
    const removed: ImportPreview['removed'] = {};
    for (const [entity, n] of Object.entries(run.removed)) {
      const s = sectionOf(entity);
      if (s) removed[s] = (removed[s] ?? 0) + n;
    }
    const hubKey = this.keyDecision(r, mode);
    const notes: string[] = [];
    if (!doc.manifest.secrets)
      notes.push(
        'O arquivo não tem Usuários nem Desligamento remoto: os usuários deste PC continuam, e as máquinas do outro PC precisam do comando de preparo para desligar por aqui.',
      );
    if (mode === 'replace' && r.sections.includes('users'))
      notes.push(
        'Os usuários serão substituídos: depois da importação, entre com um usuário do arquivo.',
      );
    if (hubKey === 'kept')
      notes.push(
        'Este PC já tem máquinas preparadas: a chave dele é mantida, e as máquinas preparadas no outro PC precisam do comando de preparo de novo.',
      );
    const standby = r.sections.some((s) => s === 'schedules' || s === 'agents');
    if (standby)
      notes.push(
        'Depois da importação este UniWake fica "em espera" (agendamentos parados) até você clicar em "Ativar este UniWake".',
      );
    return {
      mode,
      sections,
      conflicts: run.result.conflicts.map((c) => ({
        label: c.label,
        kind: c.kind,
        resolution: RESOLUTION[c.kind] ?? 'resolvido automaticamente',
      })),
      removed,
      hubKey,
      standby,
      notes,
    };
  }
}
