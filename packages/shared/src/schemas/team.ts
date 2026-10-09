/** Modo equipe API (FR-201..204, plan §14). */
import { z } from 'zod';

const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$/, 'Use um nome de computador ou um IP (ex.: 10.0.3.20).');

export const teamJoinSchema = z.object({
  address: host,
  port: z.number().int().min(1).max(65535).optional(),
  code: z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.'),
  /** `SUBSTITUIR` when this PC has data that the team's data will replace (FR-201.2). */
  confirm: z.string().max(20).optional(),
});
export type TeamJoin = z.input<typeof teamJoinSchema>;

export const teamMemberParamSchema = z.object({
  instanceId: z.string().regex(/^[0-9a-f-]{36}$/),
});

export const teamMemberUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    /** Fixed address for a PC in another subnet; null = use what announcements find. */
    address: host.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.address !== undefined, 'Nada para alterar.');
export type TeamMemberUpdate = z.input<typeof teamMemberUpdateSchema>;

export interface TeamMember {
  instanceId: string;
  name: string;
  self: boolean;
  revoked: boolean;
  online: boolean;
  address: string | null;
  manualAddress: string | null;
  lastSeenAt: number | null;
  lastSyncAt: number | null;
  lastError: string | null;
  pending: number;
}

export interface TeamPairing {
  open: boolean;
  code: string | null;
  expiresAt: number | null;
  attemptsLeft: number;
}

export interface TeamStatus {
  inTeam: boolean;
  self: { instanceId: string; name: string };
  epoch: number | null;
  members: TeamMember[];
  pairing: TeamPairing;
  /** This PC's IPv4 addresses and team port, to type on the other PC. */
  addresses: string[];
  port: number;
}

export interface TeamDiscovered {
  instanceId: string;
  name: string;
  address: string;
  port: number;
  seenAt: number;
}

export interface TeamConflict {
  id: number;
  at: number;
  entity: string;
  entityId: string;
  label: string;
  kind: 'concurrent' | 'duplicate_mac' | 'duplicate_name';
  kept: unknown;
  discarded: unknown;
  winnerInstance: string | null;
}
