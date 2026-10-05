/**
 * Enrollment tokens and the "Preparar máquinas" command (FR-007.3, ADR-011). A token's value is
 * returned once, at creation; only its SHA-256 is stored (AC-007-09).
 */
import { z } from 'zod';
import { idSchema, ipv4Schema } from './common';

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
