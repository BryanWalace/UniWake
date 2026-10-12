/**
 * The `.uniwake` document (ADR-049): sections ↔ replicated entities, the canonical JSON that the
 * checksum covers, format versions and limits. Pure: compression, crypto and the database live
 * elsewhere.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EXPORT_SECTIONS, type ExportManifest, type ExportSection } from '@uniwake/shared';

/** Current document shape; readers convert older ones step by step and refuse newer ones. */
export const EXPORT_FORMAT = 1;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_INFLATED_BYTES = 200 * 1024 * 1024;

/** Which replicated entities each section carries, in apply order (referenced ones first). */
export const SECTION_ENTITIES: Record<ExportSection, readonly string[]> = {
  inventory: ['room', 'tag', 'device'],
  schedules: ['schedule', 'schedule_exception', 'scheduler_pause'],
  settings: ['setting'],
  users: ['user'],
  agents: ['device_agent'],
  history: ['schedule_run', 'power_job', 'power_order', 'power_report'],
};

export function sectionOf(entity: string): ExportSection | null {
  for (const s of EXPORT_SECTIONS) if (SECTION_ENTITIES[s].includes(entity)) return s;
  return null;
}

/** One replicated item, as team sync carries it (no local ids, references as UUIDs). */
export interface ExportEntry {
  entity: string;
  id: string;
  rev: number;
  instance: string;
  at: number;
  payload: Record<string, unknown>;
}

/** The hub signing key inside the secret part (ADR-050). */
export interface ExportedHubKey {
  keyId: string;
  publicJwk: { n: string; e: string };
  /** PKCS#8 DER, base64. */
  pkcs8: string;
}

export interface SecretPayload {
  data: Partial<Record<ExportSection, ExportEntry[]>>;
  hubKey: ExportedHubKey | null;
}

export interface SealedSecrets {
  kdf: { alg: 'argon2id'; memory: number; passes: number; parallelism: number; salt: string };
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface ExportDocument {
  uniwake: 'export';
  format: number;
  manifest: ExportManifest;
  data: Partial<Record<ExportSection, ExportEntry[]>>;
  secrets: SealedSecrets | null;
}

/** JSON with object keys sorted at every level, so equal content gives equal bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

/** ADR-049: SHA-256 over the manifest (without its checksum) and the plain data. */
export function documentChecksum(
  manifest: Omit<ExportManifest, 'checksum'> & { checksum?: string },
  data: ExportDocument['data'],
): string {
  const { checksum: _ignored, ...rest } = manifest;
  return createHash('sha256')
    .update(canonicalJson({ manifest: rest, data }))
    .digest('hex');
}

const entrySchema = z.object({
  entity: z.string().max(40),
  id: z.string().min(1).max(200),
  rev: z.number().int().min(0),
  instance: z.string().max(100),
  at: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
});
const dataSchema = z.partialRecord(z.enum(EXPORT_SECTIONS), z.array(entrySchema));

const documentSchema = z.object({
  uniwake: z.literal('export'),
  format: z.literal(EXPORT_FORMAT),
  manifest: z.object({
    appVersion: z.string().max(64),
    createdAt: z.number().int(),
    source: z.object({ name: z.string().max(256), instanceId: z.string().max(100) }),
    sections: z.array(z.enum(EXPORT_SECTIONS)).max(EXPORT_SECTIONS.length),
    counts: z.record(z.string(), z.number().int().min(0)),
    secrets: z.boolean(),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  data: dataSchema,
  secrets: z
    .object({
      kdf: z.object({
        alg: z.literal('argon2id'),
        memory: z.number().int().min(8192).max(1_048_576),
        passes: z.number().int().min(1).max(10),
        parallelism: z.number().int().min(1).max(16),
        salt: z.string().max(100),
      }),
      iv: z.string().max(100),
      tag: z.string().max(100),
      ciphertext: z.string(),
    })
    .nullable(),
});

export const secretPayloadSchema = z.object({
  data: dataSchema,
  hubKey: z
    .object({
      keyId: z.string().max(100),
      publicJwk: z.object({ n: z.string().max(2000), e: z.string().max(20) }),
      pkcs8: z.string().max(10_000),
    })
    .nullable(),
});

export type ParseFailure =
  | { kind: 'not_uniwake' }
  | { kind: 'newer'; format: number; appVersion: string | null }
  | { kind: 'damaged' };

/** Older format → next format. Empty while format 1 is the first one; tests inject converters. */
export type FormatConverter = (doc: Record<string, unknown>) => Record<string, unknown>;
export const CONVERTERS: Record<number, FormatConverter> = {};

/**
 * Validates a parsed document: refuses files that are not ours, from a newer format or whose
 * checksum does not match; converts older formats first (FR-403.5).
 */
export function readDocument(
  raw: unknown,
  converters: Record<number, FormatConverter> = CONVERTERS,
): { ok: true; doc: ExportDocument } | { ok: false; error: ParseFailure } {
  if (
    raw === null ||
    typeof raw !== 'object' ||
    (raw as { uniwake?: unknown }).uniwake !== 'export'
  )
    return { ok: false, error: { kind: 'not_uniwake' } };
  let doc = raw as Record<string, unknown>;
  let format = typeof doc.format === 'number' ? doc.format : NaN;
  if (!Number.isInteger(format) || format < 0) return { ok: false, error: { kind: 'damaged' } };
  if (format > EXPORT_FORMAT) {
    const m = doc.manifest as { appVersion?: unknown } | undefined;
    return {
      ok: false,
      error: {
        kind: 'newer',
        format,
        appVersion: typeof m?.appVersion === 'string' ? m.appVersion.slice(0, 64) : null,
      },
    };
  }
  while (format < EXPORT_FORMAT) {
    const step = converters[format];
    if (!step) return { ok: false, error: { kind: 'damaged' } };
    doc = step(doc);
    format += 1;
  }
  const parsed = documentSchema.safeParse(doc);
  if (!parsed.success) return { ok: false, error: { kind: 'damaged' } };
  const d = parsed.data as ExportDocument;
  if (documentChecksum(d.manifest, d.data) !== d.manifest.checksum)
    return { ok: false, error: { kind: 'damaged' } };
  if (d.manifest.secrets !== (d.secrets !== null)) return { ok: false, error: { kind: 'damaged' } };
  return { ok: true, doc: d };
}

/** `UniWake-<PC>-<AAAA-MM-DD>.uniwake`, with the PC name made safe for a file name. */
export function exportFileName(pcName: string, localDay: string): string {
  const safe = pcName
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `UniWake-${safe || 'PC'}-${localDay}.uniwake`;
}

/** Matches only files this feature writes (rotation never touches anything else, ADR-052). */
export const EXPORT_FILE_PATTERN = /^UniWake-[A-Za-z0-9_-]{1,40}-\d{4}-\d{2}-\d{2}\.uniwake$/;
