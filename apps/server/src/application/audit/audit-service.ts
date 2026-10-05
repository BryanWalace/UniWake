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
  result?: AuditResult;
  /** Free text in the actor label or the target. */
  text?: string;
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

  /** Viewer/export filters (FR-006.5): an action ending in "." is a prefix. */
  static toQuery(p: {
    action?: string;
    actorUserId?: number;
    result?: AuditResult;
    q?: string;
    from?: number;
    to?: number;
  }): AuditQuery {
    return {
      ...(p.action
        ? p.action.endsWith('.')
          ? { actionPrefix: p.action }
          : { action: p.action }
        : {}),
      ...(p.actorUserId !== undefined ? { actorUserId: p.actorUserId } : {}),
      ...(p.result ? { result: p.result } : {}),
      ...(p.q ? { text: p.q } : {}),
      ...(p.from !== undefined ? { from: p.from } : {}),
      ...(p.to !== undefined ? { to: p.to } : {}),
    };
  }

  /** Everything matching, newest first, for the CSV export (capped). */
  exportRows(q: AuditQuery, max = 50_000): AuditEntry[] {
    const out: AuditEntry[] = [];
    while (out.length < max) {
      const page = this.repo.query({ ...q, limit: 500, offset: out.length });
      out.push(...page.items);
      if (page.items.length < 500) break;
    }
    return out.slice(0, max);
  }
}
