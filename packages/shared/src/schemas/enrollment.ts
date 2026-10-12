/**
 * Enrollment tokens and the "Preparar máquinas" command (FR-007.3, ADR-011). A token's value is
 * returned once, at creation; only its SHA-256 is stored (AC-007-09).
 */
import { z } from 'zod';
import { macSchema } from '../mac';
import { hostnameSchema, idSchema, ipv4Schema } from './common';

export const ENROLLMENT_TOKEN_STATES = ['ativo', 'expirado', 'revogado', 'esgotado'] as const;
export type EnrollmentTokenState = (typeof ENROLLMENT_TOKEN_STATES)[number];

export interface EnrollmentToken {
  id: number;
  roomId: number;
  roomName: string;
  roomCode: string;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revokedAt: number | null;
  state: EnrollmentTokenState;
}

/** Creation response: the only time the token value leaves the hub. */
export interface CreatedEnrollmentToken extends EnrollmentToken {
  token: string;
}

export const enrollmentTokenCreateSchema = z.object({
  roomId: idSchema,
  /** Defaults to `enrollment.tokenExpiryHours`. */
  expiresHours: z.number().int().min(1).max(168).optional(),
  /** Defaults to `enrollment.tokenMaxUses`. */
  maxUses: z.number().int().min(1).max(10_000).optional(),
});
export type EnrollmentTokenCreate = z.input<typeof enrollmentTokenCreateSchema>;

/** One address of this computer that target PCs could use to reach the agent listener. */
export interface EnrollmentAddress {
  address: string;
  interfaceName: string;
  hasGateway: boolean;
}

export interface EnrollmentAddresses {
  addresses: EnrollmentAddress[];
  /** Remembered choice when still present, else the interface with the default gateway. */
  selected: string | null;
  agentPort: number;
}

/** Tokens are base64url text; the limit only bounds the input. */
export const enrollmentTokenValueSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Código de cadastro inválido.');

/** Top-level Windows folders a persistent folder may never be (D-M19-01, as prepare-target.ps1). */
const RESERVED_FOLDERS = ['windows', 'users', 'programdata', 'recovery', 'boot', 'perflogs', 'efi'];

/**
 * A folder that survives freezing (FR-308.4), e.g. `T:\UniWake`: a drive, then a safe path (no
 * spaces or quotes, so it can go inside the one-line command). The preparation locks it down to
 * Administrators and SYSTEM, so it can be neither a Windows folder nor contain "." or ".." parts
 * (D-M19-01); the script also refuses a folder that already holds other files.
 */
export const persistentPathSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]:\\[A-Za-z0-9._\\-]{1,120}$/, 'Use uma pasta como T:\\UniWake (sem espaços).')
  .refine((p) => {
    const parts = p.slice(3).split('\\').filter(Boolean);
    return (
      parts.length > 0 &&
      parts.every((x) => !/^\.+$/.test(x)) &&
      !RESERVED_FOLDERS.includes(parts[0]!.replace(/\.+$/, '').toLowerCase())
    );
  }, 'Use uma pasta só do UniWake, como T:\\UniWake (não uma pasta do Windows).');

export const enrollmentCommandSchema = z.object({
  token: enrollmentTokenValueSchema,
  address: ipv4Schema,
  persistentPath: persistentPathSchema.optional(),
  /** Exclude the agent's data folder from the Unified Write Filter (FR-308.4). */
  uwfExclude: z.boolean().optional(),
});
export type EnrollmentCommandInput = z.input<typeof enrollmentCommandSchema>;

export interface EnrollmentCommand {
  /** One line for an elevated PowerShell: download, check SHA-256, run. */
  command: string;
  hubUrl: string;
  scriptUrl: string;
  sha256: string;
  roomCode: string;
}

const smbiosText = z.string().max(128).nullable().optional();

/**
 * `POST /agent/enroll` body from prepare-target.ps1 (FR-007.2). The token travels in
 * `Authorization: Bearer`; the whole body is limited to 8 KB by the agent listener.
 */
export const enrollRequestSchema = z.object({
  roomCode: z.string().trim().max(16),
  mac: macSchema,
  otherMacs: z.array(z.string().max(32)).max(16).default([]),
  hostname: hostnameSchema,
  ip: z
    .union([z.literal(''), ipv4Schema])
    .nullable()
    .optional(),
  manufacturer: smbiosText,
  model: smbiosText,
  serial: smbiosText,
  os: smbiosText,
  /** Step → result from the script summary (OK / FALHOU / NÃO SE APLICA / MANUAL). */
  prepareResults: z.record(z.string().max(128), z.string().max(256)).optional(),
});
export type EnrollRequest = z.input<typeof enrollRequestSchema>;

export type EnrollOutcome = 'created' | 'updated' | 'moved';

export interface EnrollResponse {
  result: EnrollOutcome;
  deviceId: number;
  room: string;
  /** pt-BR line the script prints. */
  message: string;
}
