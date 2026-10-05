import { describe, expect, it } from 'vitest';
import { AuditService, SYSTEM_ACTOR } from '../src/application/audit/audit-service';
import { SqliteAuditRepo } from '../src/db/repositories/audit-repo';
import { FakeClock } from './fakes/fake-clock';
import { T0, testDb } from './helpers/db';

function setup() {
  const db = testDb();
  const clock = new FakeClock(T0);
  const repo = new SqliteAuditRepo(db);
  return { db, clock, repo, audit: new AuditService(repo, clock) };
}

describe('audit log (FR-006.5)', () => {
  it('appends entries with actor, action, target, result, source IP and details', () => {
    const { audit, clock } = setup();
    audit.record({
      actor: { id: 1, label: 'ana' },
      action: 'wake.start',
      target: 'room:Lab 3',
      sourceIp: '127.0.0.1',
      details: { count: 28 },
    });
    clock.advance(1000);
    audit.record({ actor: SYSTEM_ACTOR, action: 'update.failed', result: 'error' });
    const { items, total } = audit.query({});
    expect(total).toBe(2);
    expect(items[0]).toMatchObject({
      action: 'update.failed',
      actorLabel: 'sistema',
      result: 'error',
      at: T0 + 1000,
    });
    expect(items[1]).toMatchObject({
      actorUserId: 1,
      actorLabel: 'ana',
      action: 'wake.start',
      target: 'room:Lab 3',
      result: 'ok',
      sourceIp: '127.0.0.1',
      details: { count: 28 },
      at: T0,
    });
  });

  it('filters by action, prefix (LIKE-escaped), actor and time range, with paging', () => {
    const { audit, clock } = setup();
    for (const action of ['wake.start', 'wake.finish', 'auth.login', 'wake_x.other']) {
      audit.record({ actor: { id: 2, label: 'bia' }, action });
      clock.advance(10);
    }
    expect(audit.query({ action: 'auth.login' }).total).toBe(1);
    expect(audit.query({ actionPrefix: 'wake.' }).total).toBe(2); // '_' and '.' are not wildcards
    expect(audit.query({ actionPrefix: 'wake_' }).total).toBe(1);
    expect(audit.query({ actorUserId: 2 }).total).toBe(4);
    expect(audit.query({ from: T0 + 10, to: T0 + 30 }).total).toBe(2);
    const page = audit.query({ limit: 2, offset: 2 });
    expect(page.items.map((i) => i.action)).toEqual(['wake.finish', 'wake.start']);
  });

  it('caps page size and exposes no update/delete operation', () => {
    const { audit, repo, clock } = setup();
    for (let i = 0; i < 3; i++) audit.record({ actor: SYSTEM_ACTOR, action: 'x' });
    expect(audit.query({ limit: 10_000 }).items).toHaveLength(3);
    expect(Object.getOwnPropertyNames(AuditService.prototype).sort()).toEqual([
      'constructor',
      'exportRows', // read-only (M6-T04)
      'query',
      'record',
    ]);
    // retention purge (M4-T16) deletes only old rows, in batches
    clock.advance(5000);
    audit.record({ actor: SYSTEM_ACTOR, action: 'recent' });
    expect(repo.purgeOlderThan(T0 + 1, 2)).toBe(2);
    expect(repo.purgeOlderThan(T0 + 1, 2)).toBe(1);
    expect(audit.query({}).items.map((i) => i.action)).toEqual(['recent']);
  });
});
