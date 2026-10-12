/**
 * `--export` / `--import` (FR-406, ADR-052). Export opens the database next to a running service
 * (WAL allows it) without migrating, restoring or touching the hub key. Import refuses while a hub
 * answers on the panel port, then runs through the normal hub composition without listening.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { EXPORT_SECTION_INFO, EXPORT_SECTIONS, type ExportSection } from '@uniwake/shared';
import { exportCodec } from '../adapters/export-codec';
import { AuditService } from '../application/audit/audit-service';
import { AppError } from '../application/errors';
import type { ExportedHubKey } from '../application/migration/document';
import { ExportService } from '../application/migration/export-service';
import type { Clock, SecretProtector } from '../application/ports';
import { jwkThumbprint } from '../application/power/hub-key';
import { SettingsService } from '../application/settings/settings-service';
import type { Config } from '../config';
import { dataPaths } from '../config';
import type { Db } from '../db/connection';
import { MIGRATIONS, currentSchemaVersion } from '../db/migrate';
import { SqliteAuditRepo } from '../db/repositories/audit-repo';
import { SqliteHubKeysRepo } from '../db/repositories/hub-keys-repo';
import { SqliteSettingsRepo } from '../db/repositories/settings-repo';
import { changesSince } from '../db/sync/apply';
import type { Hub } from '../hub';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_REFUSED = 3;
export const EXIT_BAD_FILE = 4;

const CLI_ACTOR = { id: null, label: 'linha de comando' };
const REFUSED = new Set(['IMPORT_IN_TEAM', 'IMPORT_NEWER', 'IMPORT_REPLACE_INCOMPLETE']);
const BAD_FILE = new Set([
  'IMPORT_NOT_UNIWAKE',
  'IMPORT_DAMAGED',
  'IMPORT_BAD_PASSWORD',
  'IMPORT_PASSWORD_REQUIRED',
  'IMPORT_TOO_LARGE',
]);

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

/** Default: the panel's default sections, without the secret ones when no password is given. */
export function parseSections(text: string | undefined, withSecrets: boolean): ExportSection[] {
  if (!text)
    return EXPORT_SECTIONS.filter(
      (s) => EXPORT_SECTION_INFO[s].default && (withSecrets || !EXPORT_SECTION_INFO[s].secret),
    );
  const list = text.split(',').map((s) => s.trim());
  for (const s of list) {
    if (!(EXPORT_SECTIONS as readonly string[]).includes(s))
      throw new AppError('VALIDATION_FAILED', {}, [
        {
          path: 'sections',
          message: `Parte desconhecida: ${s} (use ${EXPORT_SECTIONS.join(', ')})`,
        },
      ]);
  }
  return list as ExportSection[];
}

function password(io: CliIo, variable: string | undefined): string | undefined {
  if (!variable) return undefined;
  const v = io.env[variable];
  if (!v)
    throw new AppError('VALIDATION_FAILED', {}, [
      { path: 'password', message: `A variável ${variable} está vazia.` },
    ]);
  return v;
}

/** The active hub key, read without retiring or making one (the service owns it). */
async function readHubKey(db: Db, protector: SecretProtector): Promise<ExportedHubKey | null> {
  const row = new SqliteHubKeysRepo(db).active();
  if (!row) return null;
  try {
    const der = await protector.unprotect(row.privateBlob);
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const jwk = createPublicKey(key).export({ format: 'jwk' });
    if (jwkThumbprint({ n: jwk.n!, e: jwk.e! }) !== row.keyId) return null;
    return { keyId: row.keyId, publicJwk: row.publicJwk, pkcs8: der.toString('base64') };
  } catch {
    return null;
  }
}

export async function runExport(
  opts: {
    file: string;
    sections?: string | undefined;
    passwordEnv?: string | undefined;
    db: Db;
    protector: SecretProtector;
    clock: Clock;
    version: string;
  },
  io: CliIo,
): Promise<number> {
  try {
    const schema = currentSchemaVersion(opts.db);
    const latest = MIGRATIONS[MIGRATIONS.length - 1]!.version;
    if (schema !== latest) {
      io.err(
        schema > latest
          ? 'O banco é de uma versão mais nova do UniWake: use o UniWake instalado.'
          : 'O banco ainda não foi atualizado: inicie o serviço UniWake uma vez e tente de novo.',
      );
      return EXIT_REFUSED;
    }
    const sections = parseSections(opts.sections, opts.passwordEnv !== undefined);
    let hubKeyMissing = false;
    const exporter = new ExportService({
      changes: () => changesSince(opts.db, 0).entries,
      hubKey: async () => {
        const k = await readHubKey(opts.db, opts.protector);
        hubKeyMissing = k === null;
        return k;
      },
      self: () => ({ instanceId: '', name: hostname() }),
      codec: exportCodec,
      settings: new SettingsService(new SqliteSettingsRepo(opts.db), opts.clock),
      audit: new AuditService(new SqliteAuditRepo(opts.db), opts.clock),
      clock: opts.clock,
      version: opts.version,
    });
    const file = await exporter.build(
      { sections, password: password(io, opts.passwordEnv) },
      CLI_ACTOR,
    );
    writeFileSync(opts.file, file.bytes);
    io.out(`Exportado: ${opts.file} (${sections.join(', ')}).`);
    if (hubKeyMissing && sections.includes('agents'))
      io.out('Aviso: a chave deste UniWake não pôde ser lida e não foi incluída.');
    return EXIT_OK;
  } catch (e) {
    return fail(e, io);
  }
}

export async function runImport(
  opts: {
    file: string;
    mode: string | undefined;
    passwordEnv?: string | undefined;
    config: Config;
    hubRunning: (port: number) => Promise<boolean>;
    openHub: () => Promise<Hub>;
  },
  io: CliIo,
): Promise<number> {
  if (opts.mode !== 'merge' && opts.mode !== 'replace') {
    io.err('Use --mode merge (mesclar) ou --mode replace (substituir).');
    return EXIT_USAGE;
  }
  if (await opts.hubRunning(opts.config.panelPort)) {
    io.err('Pare o serviço UniWake antes de importar (services.msc → UniWake → Parar).');
    return EXIT_REFUSED;
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(opts.file);
  } catch {
    io.err(`Não foi possível ler ${opts.file}.`);
    return EXIT_USAGE;
  }
  let hub: Hub | null = null;
  try {
    hub = await opts.openHub();
    const importer = hub.services.importer;
    const inspected = importer.inspect(bytes, 'cli');
    if (inspected.blocked) {
      io.err(inspected.blocked);
      return EXIT_REFUSED;
    }
    const r = await importer.apply(
      inspected.importId,
      { mode: opts.mode, password: password(io, opts.passwordEnv) },
      CLI_ACTOR,
    );
    for (const [s, c] of Object.entries(r.sections))
      io.out(
        `${EXPORT_SECTION_INFO[s as ExportSection].label}: ${c.created} novos, ${c.updated} atualizados, ${c.unchanged} sem mudança, ${c.ignored} ignorados.`,
      );
    for (const n of r.notes) io.out(n);
    return EXIT_OK;
  } catch (e) {
    return fail(e, io);
  } finally {
    await hub?.stop();
  }
}

function fail(e: unknown, io: CliIo): number {
  if (e instanceof AppError) {
    const details = Array.isArray(e.details)
      ? (e.details as { message?: string }[]).map((d) => d.message).filter(Boolean)
      : [];
    io.err([e.message, ...details].join(' '));
    if (REFUSED.has(e.code)) return EXIT_REFUSED;
    if (BAD_FILE.has(e.code)) return EXIT_BAD_FILE;
    return EXIT_USAGE;
  }
  io.err(`Erro: ${(e as Error).message}`);
  return 1;
}

/** Whether a hub answers on the loopback panel port (ADR-052). */
export async function panelAnswers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

export { dataPaths };
