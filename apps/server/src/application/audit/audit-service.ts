/**
 * Audit log (FR-006.5, constitution §6.6): append-only through the application. There is no
 * update or delete operation; only the retention job purges old rows.
 */
import type { Clock } from '../ports';

export type AuditResult = 'ok' | 'error' | 'denied';

export interface Actor {
  id: number | null;
  /** Username, or "sistema", "agendamento", "inscrição" for automatic actions. */
  label: string;
}

export const SYSTEM_ACTOR: Actor = { id: null, label: 'sistema' };

export interface AuditInput {
  actor: Actor;
  action: string;
  target?: string | null;
  result?: AuditResult;
  sourceIp?: string | null;
  details?: Record<string, unknown>;
}

export interface AuditEntry {
  id: number;
  at: number;
  actorUserId: number | null;
  actorLabel: string;
  action: string;
  target: string | null;
  result: AuditResult;
  sourceIp: string | null;
  details: Record<string, unknown>;
}

export interface AuditQuery {
  action?: string;
  actionPrefix?: string;
  actorUserId?: number;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface AuditRepo {
  append(entry: Omit<AuditEntry, 'id'>): number;
  query(q: AuditQuery): { items: AuditEntry[]; total: number };
  purgeOlderThan(cutoff: number, batchSize: number): number;
}

export class AuditService {
  constructor(
    private readonly repo: AuditRepo,
    private readonly clock: Clock,
  ) {}

  record(input: AuditInput): number {
    return this.repo.append({
      at: this.clock.now(),
      actorUserId: input.actor.id,
      actorLabel: input.actor.label,
      action: input.action,
      target: input.target ?? null,
      result: input.result ?? 'ok',
      sourceIp: input.sourceIp ?? null,
      details: input.details ?? {},
    });
  }

  query(q: AuditQuery): { items: AuditEntry[]; total: number } {
    return this.repo.query({ ...q, limit: Math.min(q.limit ?? 100, 500) });
  }
}
