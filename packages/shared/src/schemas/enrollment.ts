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

export const enrollmentCommandSchema = z.object({
  token: enrollmentTokenValueSchema,
  address: ipv4Schema,
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
