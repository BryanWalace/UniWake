import type {
  AuditEntry,
  AuditQuery,
  AuditRepo,
  AuditResult,
} from '../../application/audit/audit-service';
import type { Db } from '../connection';

interface Row {
  id: number;
  at: number;
  actor_user_id: number | null;
  actor_label: string;
  action: string;
  target: string | null;
  result: string;
  source_ip: string | null;
  details: string;
}

const toEntry = (r: Row): AuditEntry => ({
  id: r.id,
  at: r.at,
  actorUserId: r.actor_user_id,
  actorLabel: r.actor_label,
  action: r.action,
  target: r.target,
  result: r.result as AuditResult,
  sourceIp: r.source_ip,
  details: JSON.parse(r.details) as Record<string, unknown>,
});

export class SqliteAuditRepo implements AuditRepo {
  constructor(private readonly db: Db) {}

  append(e: Omit<AuditEntry, 'id'>): number {
    return this.db.run(
      `INSERT INTO audit_log (at, actor_user_id, actor_label, action, target, result, source_ip, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.at,
        e.actorUserId,
        e.actorLabel,
        e.action,
        e.target,
        e.result,
        e.sourceIp,
        JSON.stringify(e.details),
      ],
    ).lastInsertRowid;
  }

  query(q: AuditQuery): { items: AuditEntry[]; total: number } {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (q.action) {
      where.push('action = :action');
      params.action = q.action;
    }
    if (q.actionPrefix) {
      where.push("action LIKE :prefix ESCAPE '\\'");
      params.prefix = `${q.actionPrefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    }
    if (q.actorUserId !== undefined) {
      where.push('actor_user_id = :actor');
      params.actor = q.actorUserId;
    }
    if (q.from !== undefined) {
      where.push('at >= :from');
      params.from = q.from;
    }
    if (q.to !== undefined) {
      where.push('at < :to');
      params.to = q.to;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total =
      this.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM audit_log ${clause}`,
        params,
      )?.n ?? 0;
    const items = this.db
      .all<Row>(
        `SELECT * FROM audit_log ${clause} ORDER BY at DESC, id DESC LIMIT :limit OFFSET :offset`,
        { ...params, limit: q.limit ?? 100, offset: q.offset ?? 0 },
      )
      .map(toEntry);
    return { items, total };
  }

  purgeOlderThan(cutoff: number, batchSize: number): number {
    return this.db.run(
      'DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE at < ? LIMIT ?)',
      [cutoff, batchSize],
    ).changes;
  }
}
