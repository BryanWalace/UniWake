/**
 * "Backup e migração" (spec §6c, ADR-049..052): sections of a `.uniwake` file, its manifest and the
 * export/import requests.
 */
import { z } from 'zod';

export const EXPORT_SECTIONS = [
  'inventory',
  'schedules',
  'settings',
  'users',
  'agents',
  'history',
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export const EXPORT_SECTION_INFO: Record<
  ExportSection,
  { label: string; detail: string; secret: boolean; default: boolean }
> = {
  inventory: {
    label: 'Cadastro',
    detail: 'Salas, etiquetas e máquinas',
    secret: false,
    default: true,
  },
  schedules: {
    label: 'Agendamentos',
    detail: 'Agendamentos de ligar e desligar, exceções e pausa',
    secret: false,
    default: true,
  },
  settings: {
    label: 'Configurações gerais',
    detail: 'Configurações que valem para a equipe (não as deste PC)',
    secret: false,
    default: true,
  },
  users: {
    label: 'Usuários',
    detail: 'Usuários, perfis e senhas (protegidos pela senha do arquivo)',
    secret: true,
    default: true,
  },
  agents: {
    label: 'Desligamento remoto',
    detail: 'Máquinas preparadas para desligar e a chave deste UniWake (protegidas pela senha)',
    secret: true,
    default: true,
  },
  history: {
    label: 'Histórico',
    detail: 'Execuções dos agendamentos e desligamentos',
    secret: false,
    default: false,
  },
};

/** ADR-050: at least 10 characters; typed twice in the panel. */
export const exportPasswordSchema = z
  .string()
  .min(10, 'Use uma senha com pelo menos 10 caracteres.')
  .max(256, 'Senha longa demais.');

export const exportRequestSchema = z
  .object({
    sections: z
      .array(z.enum(EXPORT_SECTIONS))
      .min(1, 'Escolha pelo menos uma parte.')
      .max(EXPORT_SECTIONS.length),
    password: exportPasswordSchema.optional(),
  })
  .refine(
    (r) => r.password !== undefined || r.sections.every((s) => !EXPORT_SECTION_INFO[s].secret),
    {
      message: 'Usuários e Desligamento remoto só podem ser exportados com senha.',
      path: ['password'],
    },
  );
export type ExportRequest = z.input<typeof exportRequestSchema>;

export interface ExportManifest {
  appVersion: string;
  createdAt: number;
  source: { name: string; instanceId: string };
  sections: ExportSection[];
  /** Items per entity, secret ones included. */
  counts: Record<string, number>;
  secrets: boolean;
  /** SHA-256 (hex) of the canonical JSON of the manifest without it, and the data (ADR-049). */
  checksum: string;
}

export const IMPORT_MODES = ['merge', 'replace'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const importPreviewSchema = z.object({
  mode: z.enum(IMPORT_MODES),
  password: z.string().max(256).optional(),
});

export const importApplySchema = importPreviewSchema.extend({
  confirm: z.literal('IMPORTAR', { message: 'Digite IMPORTAR para confirmar.' }),
});

export interface ImportInspect {
  importId: string;
  manifest: ExportManifest;
  format: number;
  /** Why this PC cannot import it now (team), or null. */
  blocked: string | null;
}

export interface ImportSectionCounts {
  created: number;
  updated: number;
  unchanged: number;
  ignored: number;
}

export interface ImportPreview {
  mode: ImportMode;
  sections: Partial<Record<ExportSection, ImportSectionCounts>>;
  conflicts: { label: string; kind: string; resolution: string }[];
  /** Replace mode: items of this PC that disappear, per section. */
  removed: Partial<Record<ExportSection, number>>;
  hubKey: 'imported' | 'kept' | 'none';
  standby: boolean;
  notes: string[];
}

export interface MigrationState {
  standby: { since: number; from: string; by: string } | null;
  lastImport: {
    at: number;
    from: string;
    mode: ImportMode;
    backupId: number | null;
    undoUntil: number;
  } | null;
  lastAutoExport: { at: number; ok: boolean; file: string | null; error: string | null } | null;
}
