/** Audit viewer (FR-006.5). */
import { z } from 'zod';

export const AUDIT_RESULTS = ['ok', 'error', 'denied'] as const;

export const auditQuerySchema = z.object({
  /** Exact action or a prefix ending in "." (e.g. "wake."). */
  action: z.string().trim().max(64).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
  result: z.enum(AUDIT_RESULTS).optional(),
  /** Free text in the actor or the target. */
  q: z.string().trim().max(100).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQueryParams = z.output<typeof auditQuerySchema>;

export interface AuditRow {
  id: number;
  at: number;
  actorUserId: number | null;
  actorLabel: string;
  action: string;
  target: string | null;
  result: (typeof AUDIT_RESULTS)[number];
  sourceIp: string | null;
  details: Record<string, unknown>;
}
