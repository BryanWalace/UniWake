import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LogFileReader } from '../src/adapters/log-reader';
import { createFileLogger, LOG_FILE } from '../src/adapters/logger';
import { apiHarness, type ApiHarness } from './helpers/api';

const dirs: string[] = [];
const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function logDir(lines: object[] = []) {
  const d = mkdtempSync(join(tmpdir(), 'uniwake-logs-'));
  dirs.push(d);
  if (lines.length > 0) {
    writeFileSync(
      join(d, LOG_FILE),
      [...lines.map((l) => JSON.stringify({ app: 'uniwake', ...l })), '{cortada pela rota'].join(
        '\n',
      ),
    );
  }
  return d;
}

const LINES = [
  { level: 'debug', time: '2026-10-05T09:00:00Z', msg: 'request' },
  { level: 'info', time: '2026-10-05T09:00:01Z', msg: 'UniWake hub started', version: '1.0.0' },
  {
    level: 'warn',
    time: '2026-10-05T09:00:02Z',
    msg: 'probe helper exited',
    module: 'probe-helper',
  },
  {
    level: 'error',
    time: '2026-10-05T09:00:03Z',
    msg: 'monitoring sweep failed',
    module: 'monitor',
  },
];

describe('log reader (FR-016)', () => {
  it('lists newest first, filters by minimum level and text, skips broken lines', () => {
    const r = new LogFileReader(logDir(LINES));
    expect(r.read().entries.map((e) => e.msg)).toEqual([
      'monitoring sweep failed',
      'probe helper exited',
      'UniWake hub started',
      'request',
    ]);
    expect(r.read({ level: 'warn' }).entries.map((e) => e.level)).toEqual(['error', 'warn']);
    expect(r.read({ q: 'HELPER' }).entries).toEqual([
      {
        time: '2026-10-05T09:00:02Z',
        level: 'warn',
        msg: 'probe helper exited',
        module: 'probe-helper',
        data: {},
      },
    ]);
    expect(r.read({ limit: 1 }).entries).toHaveLength(1);
    expect(r.read().entries[2]!.data).toEqual({ version: '1.0.0' });
  });

  it('reads only the tail of a big file and drops the partial first line', () => {
    const r = new LogFileReader(logDir(LINES));
    const tail = r.tail(120);
    expect(tail.truncated).toBe(true);
    expect(tail.text.startsWith('{')).toBe(true);
    expect(new LogFileReader(logDir()).read()).toEqual({ entries: [], truncated: false, size: 0 });
  });

  it('secrets are already redacted in the file the viewer reads', async () => {
    const d = logDir();
    const f = createFileLogger(d, 'info');
    f.logger.info({ password: 'segredo-123', token: 'abc', user: 'ana' }, 'login');
    await f.close();
    const [entry] = new LogFileReader(d).read().entries;
    expect(entry!.data).toMatchObject({ password: '[redacted]', token: '[redacted]', user: 'ana' });
  });
});

describe('log API (FR-016)', () => {
  it('admins read and download the log; operators get 403 (AC-016-02)', async () => {
    const h = await apiHarness();
    hs.push(h);
    h.services.logs = new LogFileReader(logDir(LINES));
    const admin = await h.as('admin');
    const list = await h.inject({ url: '/api/logs?level=warn&q=monitor', cookie: admin });
    expect(list.json<{ entries: { msg: string }[] }>().entries.map((e) => e.msg)).toEqual([
      'monitoring sweep failed',
    ]);
    const dl = await h.inject({ url: '/api/logs/download', cookie: admin });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(
      /attachment; filename="uniwake-log-\d{4}-\d{2}-\d{2}\.log"/,
    );
    expect(dl.body).toContain('UniWake hub started');
    const operator = await h.as('operator');
    expect((await h.inject({ url: '/api/logs', cookie: operator })).statusCode).toBe(403);
    expect((await h.inject({ url: '/api/logs/download', cookie: operator })).statusCode).toBe(403);
    expect((await h.inject({ url: '/api/logs?level=trace', cookie: admin })).statusCode).toBe(422);
  });
});
