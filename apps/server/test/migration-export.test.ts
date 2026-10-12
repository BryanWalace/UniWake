/**
 * M21-T03 (FR-401, FR-402, ADR-049/050): `POST /api/migration/export` — sections, what never
 * leaves the PC, the sealed secret part and the audit record.
 */
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { open } from '../src/application/migration/secret-box';
import { type ExportDocument, readDocument } from '../src/application/migration/document';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const PASSWORD = 'senha-de-exportacao';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function populated() {
  const h: ApiHarness = await apiHarness();
  cleanups.push(() => h.close());
  const cookie = await h.as('admin');
  const s = h.services;
  const room = s.rooms.create({ name: 'Lab 1' }, ACTOR);
  const tag = s.tags.create({ name: 'Projetor' }, ACTOR);
  s.devices.create(
    { name: 'LAB1-PC01', mac: '00:AA:00:00:00:01', roomId: room.id, tagIds: [tag.id] },
    ACTOR,
  );
  s.schedules.create(
    {
      name: 'Manhã',
      weekdays: 31,
      timeLocal: '07:00',
      target: { type: 'rooms', roomIds: [room.id] },
    },
    ACTOR,
  );
  s.settings.update({ 'wake.repeat': 4 }, null);
  // A machine setting (this PC only): never exported (FR-401.2).
  s.db.run(
    "INSERT INTO machine_settings (key, value, updated_at) VALUES ('wake.interfaces', '[\"10.9.9.9\"]', 0)",
  );
  const exportFile = (payload: object) =>
    h.inject({ method: 'POST', url: '/api/migration/export', cookie, payload });
  return { h, cookie, exportFile };
}

const parse = (raw: Buffer) => JSON.parse(gunzipSync(raw).toString('utf8')) as ExportDocument;

describe('export (FR-401)', () => {
  it('AC-401-01: without a password the file carries Cadastro, Agendamentos and shared settings only', async () => {
    const { exportFile } = await populated();
    const r = await exportFile({ sections: ['inventory', 'schedules', 'settings'] });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(r.headers['content-disposition']).toMatch(
      /^attachment; filename="UniWake-[A-Za-z0-9_-]+-\d{4}-\d{2}-\d{2}\.uniwake"$/,
    );
    const doc = parse(r.rawPayload);
    expect(readDocument(doc).ok).toBe(true);
    expect(doc.secrets).toBeNull();
    expect(doc.manifest).toMatchObject({
      sections: ['inventory', 'schedules', 'settings'],
      secrets: false,
      counts: { room: 1, tag: 1, device: 1, schedule: 1 },
    });
    const entities = Object.values(doc.data)
      .flat()
      .map((e) => e.entity);
    expect(entities).toEqual(expect.arrayContaining(['room', 'tag', 'device', 'schedule']));
    expect(entities).not.toContain('user');
    expect(entities).not.toContain('team_member');
    const text = gunzipSync(r.rawPayload).toString('utf8');
    expect(text).toContain('wake.repeat');
    expect(text).not.toContain('wake.interfaces'); // machine setting
    expect(text).not.toContain('10.9.9.9');
    expect(text).not.toContain('passwordHash');
  });

  it('AC-401-02: Usuários without a password, or a short one, is refused', async () => {
    const { exportFile } = await populated();
    const noPassword = await exportFile({ sections: ['inventory', 'users'] });
    expect(noPassword.statusCode).toBe(422);
    expect(noPassword.body).toMatch(/só podem ser exportados com senha/);
    const short = await exportFile({ sections: ['users'], password: '123456789' });
    expect(short.statusCode).toBe(422);
    expect(short.body).toMatch(/pelo menos 10/);
  });

  it('AC-402-02: with a password, users and agent records are sealed, never in clear', async () => {
    const { h, exportFile } = await populated();
    const r = await exportFile({
      sections: ['inventory', 'users', 'agents'],
      password: PASSWORD,
    });
    expect(r.statusCode).toBe(200);
    const text = gunzipSync(r.rawPayload).toString('utf8');
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('$argon2id$');
    expect(text).not.toContain(PASSWORD);
    const doc = parse(r.rawPayload);
    expect(doc.manifest.secrets).toBe(true);
    expect(doc.data.users).toBeUndefined();
    const inner = JSON.parse(
      (await open(doc.secrets!, PASSWORD, doc.manifest.checksum)).toString('utf8'),
    ) as { data: ExportDocument['data']; hubKey: { keyId: string } | null };
    expect(inner.data.users!.map((u) => u.payload.username)).toContain('admin-user');
    expect(inner.data.users![0]!.payload.passwordHash).toMatch(/^\$argon2id\$/);
    expect(inner.hubKey!.keyId).toBe(h.services.hubKey.keyId());
  });

  it('is audited with its sections, never the password; operators cannot export', async () => {
    const { h, exportFile } = await populated();
    await exportFile({ sections: ['inventory', 'users'], password: PASSWORD });
    const audit = h.services.audit.query({ action: 'migration.export' });
    expect(audit.total).toBe(1);
    expect(audit.items[0]!.details).toMatchObject({
      sections: ['inventory', 'users'],
      secrets: true,
    });
    expect(JSON.stringify(audit.items)).not.toContain(PASSWORD);
    const operator = await h.as('operator');
    const r = await h.inject({
      method: 'POST',
      url: '/api/migration/export',
      cookie: operator,
      payload: { sections: ['inventory'] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('tombstones and history stay out unless asked for', async () => {
    const { h, exportFile } = await populated();
    const gone = h.services.rooms.create({ name: 'Sala apagada' }, ACTOR);
    h.services.rooms.delete(gone.id, true, ACTOR);
    const doc = parse((await exportFile({ sections: ['inventory'] })).rawPayload);
    expect(doc.data.inventory!.map((e) => e.payload.name)).not.toContain('Sala apagada');
    expect(doc.data.history).toBeUndefined();
  });
});
