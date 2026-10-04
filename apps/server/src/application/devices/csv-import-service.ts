/**
 * CSV import/export (FR-002.3). Preview is stateless and never writes (AC-002-08); commit
 * re-validates and applies valid rows in one transaction with one audit entry.
 */
import { z } from 'zod';
import {
  DEFAULT_ROOM_COLOR,
  DEFAULT_TAG_COLOR,
  hostnameSchema,
  ipv4Schema,
  LIMITS,
  macSchema,
  nameSchema,
  tagNameSchema,
} from '@uniwake/shared';
import {
  type CsvColumn,
  type CsvRow,
  devicesToCsv,
  parseBoolean,
  parseDevicesCsv,
} from '../../domain/csv';
import { suggestRoomCode } from '../../domain/room-code';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock } from '../ports';
import type { RoomsRepo } from '../rooms/rooms-service';
import type { TagsRepo } from '../tags/tags-service';
import type { DevicesRepo, DeviceWrite } from './devices-service';

export const csvImportSchema = z.object({
  csv: z
    .string()
    .min(1)
    .max(3 * 1024 * 1024),
  onDuplicate: z.enum(['update', 'skip']).default('skip'),
  createMissing: z.boolean().default(true),
});
export type CsvImportInput = z.input<typeof csvImportSchema>;

export type RowStatus = 'create' | 'update' | 'skip' | 'error';

export interface PreviewRow {
  line: number;
  status: RowStatus;
  name: string;
  mac: string;
  room: string | null;
  reasons: string[];
}

export interface ImportPreview {
  rows: PreviewRow[];
  summary: Record<RowStatus, number>;
  roomsToCreate: string[];
  tagsToCreate: string[];
  ignoredColumns: string[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  roomsCreated: string[];
  tagsCreated: string[];
}

interface ValidRow {
  line: number;
  name: string;
  mac: string;
  ip: string | null;
  hostname: string | null;
  room: string | null;
  tags: string[];
  notes: string | null;
  enabled: boolean;
}

interface Plan {
  preview: ImportPreview;
  apply: { row: ValidRow; existingId: number | null }[];
  columns: CsvColumn[];
}

const fold = (s: string) => s.trim().toLowerCase();

export class CsvImportService {
  constructor(
    private readonly devices: DevicesRepo,
    private readonly rooms: RoomsRepo,
    private readonly tags: TagsRepo,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly transaction: <T>(fn: () => T) => T,
  ) {}

  preview(input: CsvImportInput): ImportPreview {
    return this.plan(csvImportSchema.parse(input)).preview;
  }

  commit(input: CsvImportInput, actor: Actor): ImportResult {
    const opts = csvImportSchema.parse(input);
    const now = this.clock.now();
    const result = this.transaction(() => {
      const plan = this.plan(opts);
      const roomIds = new Map(this.rooms.list().map((r) => [fold(r.name), r.id]));
      for (const r of this.rooms.list()) roomIds.set(fold(r.code), r.id);
      const tagIds = new Map(this.tags.list().map((t) => [fold(t.name), t.id]));

      const roomsCreated: string[] = [];
      for (const name of plan.preview.roomsToCreate) {
        const id = this.rooms.insert(
          {
            name,
            code: suggestRoomCode(name, (c) => this.rooms.codeTaken(c)),
            block: null,
            floor: null,
            color: DEFAULT_ROOM_COLOR,
            notes: null,
            directedBroadcast: null,
            batchSize: null,
            batchDelaySeconds: null,
          },
          now,
        );
        roomIds.set(fold(name), id);
        roomsCreated.push(name);
      }
      const tagsCreated: string[] = [];
      for (const name of plan.preview.tagsToCreate) {
        tagIds.set(fold(name), this.tags.insert(name, DEFAULT_TAG_COLOR));
        tagsCreated.push(name);
      }

      let created = 0;
      let updated = 0;
      for (const { row, existingId } of plan.apply) {
        const roomId = row.room ? (roomIds.get(fold(row.room)) ?? null) : null;
        const tagList = row.tags.map((t) => tagIds.get(fold(t))!);
        if (existingId === null) {
          const id = this.devices.insert(
            {
              name: row.name,
              mac: row.mac,
              ip: row.ip,
              hostname: row.hostname,
              roomId,
              notes: row.notes,
              enabled: row.enabled,
            },
            now,
          );
          this.devices.setTags(id, tagList);
          created++;
        } else {
          const cur = this.devices.get(existingId)!;
          const has = (c: CsvColumn) => plan.columns.includes(c);
          const next: DeviceWrite = {
            name: row.name,
            mac: row.mac,
            ip: has('ip') ? row.ip : cur.ip,
            hostname: has('hostname') ? row.hostname : cur.hostname,
            roomId: has('sala') ? roomId : cur.roomId,
            notes: has('observacoes') ? row.notes : cur.notes,
            enabled: has('ativo') ? row.enabled : cur.enabled,
          };
          this.devices.update(existingId, next, now);
          if (has('tags')) this.devices.setTags(existingId, tagList);
          updated++;
        }
      }
      return {
        created,
        updated,
        skipped: plan.preview.summary.skip,
        errors: plan.preview.summary.error,
        roomsCreated,
        tagsCreated,
      };
    });
    this.audit.record({ actor, action: 'device.import', target: 'csv', details: { ...result } });
    return result;
  }

  exportCsv(): string {
    const roomNames = new Map(this.rooms.list().map((r) => [r.id, r.name]));
    const tagNames = new Map(this.tags.list().map((t) => [t.id, t.name]));
    const { items } = this.devices.list({}, LIMITS.compactListMax * 10, 0);
    return devicesToCsv(
      items.map((d) => ({
        nome: d.name,
        mac: d.mac,
        ip: d.ip,
        hostname: d.hostname,
        sala: d.roomId === null ? null : (roomNames.get(d.roomId) ?? null),
        tags: d.tagIds.map((t) => tagNames.get(t) ?? '').filter(Boolean),
        observacoes: d.notes,
        ativo: d.enabled,
      })),
    );
  }

  private plan(opts: z.output<typeof csvImportSchema>): Plan {
    const parsed = parseDevicesCsv(opts.csv);
    if (!parsed.ok) {
      if (parsed.reason === 'too_large') throw new AppError('CSV_TOO_LARGE');
      throw new AppError('CSV_INVALID', { reason: parsed.reason });
    }
    const knownRooms = new Set<string>();
    for (const r of this.rooms.list()) {
      knownRooms.add(fold(r.name));
      knownRooms.add(fold(r.code));
    }
    const knownTags = new Set(this.tags.list().map((t) => fold(t.name)));
    const roomsToCreate = new Map<string, string>();
    const tagsToCreate = new Map<string, string>();
    const seenMacs = new Map<string, number>();

    const rows: PreviewRow[] = [];
    const apply: Plan['apply'] = [];
    for (const raw of parsed.rows) {
      const { row, reasons } = validate(raw);
      if (row) {
        const firstLine = seenMacs.get(row.mac);
        if (firstLine !== undefined) reasons.push(`MAC repetido no arquivo (linha ${firstLine}).`);
        else seenMacs.set(row.mac, row.line);
        if (row.room && !knownRooms.has(fold(row.room))) {
          if (opts.createMissing) roomsToCreate.set(fold(row.room), row.room);
          else reasons.push(`Sala "${row.room}" não existe.`);
        }
        for (const t of row.tags) {
          if (!knownTags.has(fold(t))) {
            if (opts.createMissing) tagsToCreate.set(fold(t), t);
            else reasons.push(`Etiqueta "${t}" não existe.`);
          }
        }
      }
      if (!row || reasons.length > 0) {
        rows.push({
          line: raw.line,
          status: 'error',
          name: raw.nome,
          mac: raw.mac,
          room: raw.sala || null,
          reasons,
        });
        continue;
      }
      const existing = this.devices.findByMac(row.mac);
      const status: RowStatus = existing
        ? opts.onDuplicate === 'update'
          ? 'update'
          : 'skip'
        : 'create';
      rows.push({
        line: row.line,
        status,
        name: row.name,
        mac: row.mac,
        room: row.room,
        reasons: existing ? [`MAC já cadastrado em "${existing.name}".`] : [],
      });
      if (status !== 'skip') apply.push({ row, existingId: existing?.id ?? null });
    }
    const summary: Record<RowStatus, number> = { create: 0, update: 0, skip: 0, error: 0 };
    for (const r of rows) summary[r.status]++;
    return {
      preview: {
        rows,
        summary,
        roomsToCreate: [...roomsToCreate.values()],
        tagsToCreate: [...tagsToCreate.values()],
        ignoredColumns: parsed.ignoredColumns,
      },
      apply,
      columns: parsed.columns,
    };
  }
}

function validate(raw: CsvRow): { row: ValidRow | null; reasons: string[] } {
  const reasons: string[] = [];
  const name = nameSchema.safeParse(raw.nome);
  if (!name.success) reasons.push('Nome inválido ou vazio.');
  const mac = macSchema.safeParse(raw.mac);
  if (!mac.success) reasons.push(mac.error.issues[0]?.message ?? 'MAC inválido.');
  let ip: string | null = null;
  if (raw.ip) {
    const r = ipv4Schema.safeParse(raw.ip);
    if (r.success) ip = r.data;
    else reasons.push('IP inválido.');
  }
  let hostname: string | null = null;
  if (raw.hostname) {
    const r = hostnameSchema.safeParse(raw.hostname);
    if (r.success) hostname = r.data;
    else reasons.push('Nome de host inválido.');
  }
  const room = raw.sala ? nameSchema.safeParse(raw.sala) : null;
  if (room && !room.success) reasons.push('Nome de sala inválido.');
  for (const t of raw.tags) {
    if (!tagNameSchema.safeParse(t).success)
      reasons.push(`Etiqueta inválida: "${t.slice(0, 40)}".`);
  }
  if (raw.observacoes.length > LIMITS.notes)
    reasons.push(`Observações com mais de ${LIMITS.notes} caracteres.`);
  const enabled = parseBoolean(raw.ativo);
  if (enabled === null) reasons.push('Valor de "ativo" não reconhecido (use sim ou não).');
  if (!name.success || !mac.success || reasons.length > 0) return { row: null, reasons };
  return {
    row: {
      line: raw.line,
      name: name.data,
      mac: mac.data,
      ip,
      hostname,
      room: room?.success ? room.data : null,
      tags: [...new Set(raw.tags)],
      notes: raw.observacoes || null,
      enabled: enabled ?? true,
    },
    reasons,
  };
}
