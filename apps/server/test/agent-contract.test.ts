/**
 * M16-T04: the agent wire contract (spec FR-302..304, ADR-043/045). The JSON fixtures are shared
 * with the PowerShell agent's Pester tests, so both sides read the same documents.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agendaSchema,
  agentOrderSchema,
  checkinAnswerSchema,
  checkinRequestSchema,
  enrollAgentRequestSchema,
} from '@uniwake/shared';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'packages', 'shared', 'fixtures', 'agent', name),
      'utf8',
    ),
  ) as Record<string, unknown>;

const request = () => fixture('checkin-request.json');
const answer = () => fixture('checkin-answer.json');

describe('agent contract fixtures (protocol 1)', () => {
  it('the request and answer fixtures follow the contract', () => {
    expect(checkinRequestSchema.safeParse(request()).success).toBe(true);
    const a = checkinAnswerSchema.parse(answer());
    expect(a.agenda.items.length).toBeGreaterThan(0);
    expect(a.orders.map((o) => o.action)).toEqual(['restart', 'cancel']);
  });

  it('refuses any field the contract does not name, such as a user name (LGPD, Q-6)', () => {
    const withUser = request();
    (withUser.session as Record<string, unknown>).userName = 'aluno01';
    expect(checkinRequestSchema.safeParse(withUser).success).toBe(false);
    const reportWithUser = request();
    (reportWithUser.reports as Record<string, unknown>[])[0]!.user = 'aluno01';
    expect(checkinRequestSchema.safeParse(reportWithUser).success).toBe(false);
    expect(checkinRequestSchema.safeParse({ ...request(), extra: 1 }).success).toBe(false);
  });

  it('a report belongs to an agenda item, an order, or an order pushed for an occurrence (ADR-053)', () => {
    const both = request();
    const r = (both.reports as Record<string, unknown>[])[0]!;
    r.order = 'b1b2c3d4-0000-4000-8000-000000000001';
    expect(checkinRequestSchema.safeParse(both).success).toBe(true);
    r.occurrence = null;
    expect(checkinRequestSchema.safeParse(both).success).toBe(true);
    r.order = null;
    expect(checkinRequestSchema.safeParse(both).success).toBe(false);
  });

  it('agenda items must lie inside the explicit window (Q-4)', () => {
    const agenda = answer().agenda as {
      window: { from: number; to: number };
      items: { at: number }[];
    };
    expect(agendaSchema.safeParse(agenda).success).toBe(true);
    agenda.items[0]!.at = agenda.window.to + 1;
    expect(agendaSchema.safeParse(agenda).success).toBe(false);
    agenda.items[0]!.at = agenda.window.from - 1;
    expect(agendaSchema.safeParse(agenda).success).toBe(false);
  });

  it('caps warnings and postpones and names cancellations explicitly', () => {
    const base = {
      uuid: 'b1b2c3d4-0000-4000-8000-000000000001',
      action: 'shutdown',
      warningMinutes: 5,
      allowPostpone: true,
      postponeMax: 2,
      postponeMinutes: 15,
    };
    expect(agentOrderSchema.safeParse(base).success).toBe(true);
    expect(agentOrderSchema.safeParse({ ...base, warningMinutes: 31 }).success).toBe(false);
    expect(agentOrderSchema.safeParse({ ...base, postponeMax: 6 }).success).toBe(false);
    expect(agentOrderSchema.safeParse({ ...base, postponeMinutes: 4 }).success).toBe(false);
    expect(agentOrderSchema.safeParse({ uuid: base.uuid, action: 'cancel' }).success).toBe(false);
  });

  it('only v1.3 scripts ask for an agent token at enrollment, with a nonce', () => {
    expect(
      enrollAgentRequestSchema.safeParse({ protocol: 1, nonce: 'q5KX2nX0v4m8Zk1d0b7S9w' }).success,
    ).toBe(true);
    expect(enrollAgentRequestSchema.safeParse({ protocol: 2, nonce: 'x'.repeat(22) }).success).toBe(
      false,
    );
    expect(enrollAgentRequestSchema.safeParse({ protocol: 1, nonce: 'curto' }).success).toBe(false);
  });
});

describe('agent health (v1.6.0, ADR-059)', () => {
  const health = () => fixture('checkin-health.json');

  it('AC-603-01: health is optional; the fixture follows the contract; hubs announce it', () => {
    expect(checkinRequestSchema.safeParse(request()).success).toBe(true); // no health: v1.5.0 shape
    const withHealth = { ...request(), health: health() };
    expect(checkinRequestSchema.safeParse(withHealth).success).toBe(true);
    expect(checkinAnswerSchema.parse(answer()).features).toEqual(['health']);
    const { features: _omit, ...older } = answer();
    expect(checkinAnswerSchema.safeParse(older).success).toBe(true); // v1.5.0 answers
  });

  it('drops (never stores) fields a newer agent adds inside health; refuses bad values', () => {
    const h = health() as {
      update: Record<string, unknown>;
      antivirus: { products: Record<string, unknown>[] };
    };
    h.update.futureField = 'x';
    h.antivirus.products[0]!.user = 'aluno01';
    const parsed = checkinRequestSchema.parse({ ...request(), health: h });
    expect(parsed.health!.update).not.toHaveProperty('futureField');
    expect(parsed.health!.antivirus!.products[0]).not.toHaveProperty('user');
    const bad = health() as { update: { outcome: string } };
    bad.update.outcome = 'apagou tudo';
    expect(checkinRequestSchema.safeParse({ ...request(), health: bad }).success).toBe(false);
  });
});
