import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createStreamLogger, rotationOptions } from '../src/adapters/logger';
import { CONFIG_DEFAULTS, ConfigError, dataPaths, resolveConfig } from '../src/config';

describe('bootstrap config (constitution §2.4)', () => {
  it('uses code defaults when there is no file and no env', () => {
    const c = resolveConfig(null, {}, { dataDir: 'D:/x' });
    expect(c).toEqual({ ...CONFIG_DEFAULTS, dataDir: 'D:/x', demo: false });
    expect(c.panelBind).toBe('127.0.0.1');
    expect(c.panelPort).toBe(47100);
    expect(c.agentPort).toBe(47101);
  });

  it('precedence: defaults < config.json < env', () => {
    const file = JSON.stringify({ panelPort: 48000, agentPort: 48001, logLevel: 'warn' });
    const c = resolveConfig(file, { UNIWAKE_PANEL_PORT: '49000', UNIWAKE_DATA_DIR: 'E:/d' });
    expect(c.panelPort).toBe(49000); // env wins
    expect(c.agentPort).toBe(48001); // file wins over default
    expect(c.logLevel).toBe('warn');
    expect(c.panelBind).toBe('127.0.0.1'); // default
    expect(c.dataDir).toBe('E:/d');
  });

  it('accepts a UTF-8 BOM (Notepad) and an empty file', () => {
    expect(resolveConfig('\uFEFF{"panelPort": 47200}', {}).panelPort).toBe(47200);
    expect(resolveConfig('  ', {}).panelPort).toBe(47100);
  });

  it('rejects invalid JSON, unknown keys and bad values with a clear message', () => {
    expect(() => resolveConfig('{', {})).toThrow(ConfigError);
    expect(() => resolveConfig('{"panelPort": 0}', {})).toThrow(/config.json is invalid/);
    expect(() => resolveConfig('{"updateRepo": "evil/repo"}', {})).toThrow(ConfigError);
    expect(() => resolveConfig(null, { UNIWAKE_PANEL_BIND: 'not-an-ip' })).toThrow(
      /environment variables are invalid/,
    );
  });

  it('defaults the data dir to %ProgramData%\\UniWake and reads demo flag', () => {
    expect(resolveConfig(null, { ProgramData: 'C:\\ProgramData' }).dataDir).toMatch(/UniWake$/);
    expect(resolveConfig(null, { UNIWAKE_DEMO: '1' }).demo).toBe(true);
    const p = dataPaths('C:/PD/UniWake');
    expect(p.db.replace(/\\/g, '/')).toBe('C:/PD/UniWake/data/uniwake.db');
    expect(p.config.replace(/\\/g, '/')).toBe('C:/PD/UniWake/config.json');
  });
});

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split('\n').filter(Boolean))
        lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  return { logger: createStreamLogger(stream), lines };
}

describe('logger (NFR-04, constitution §4.1)', () => {
  it('writes structured JSON with level label, module binding and ISO time', () => {
    const { logger, lines } = captureLogger();
    logger.child({ module: 'wake' }).info({ jobId: 7 }, 'job started');
    expect(lines[0]).toMatchObject({
      level: 'info',
      module: 'wake',
      jobId: 7,
      msg: 'job started',
      app: 'uniwake',
    });
    expect(typeof lines[0]?.time).toBe('string');
  });

  it('redacts passwords, tokens, cookies and session ids at any nesting level used by the app', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      password: 'hunter2hunter2',
      token: 'abc',
      body: { password: 'x', newPassword: 'y', token: 'z' },
      req: { headers: { cookie: 'uw_session=secret', authorization: 'Bearer q' } },
    });
    const text = JSON.stringify(lines[0]);
    for (const secret of ['hunter2hunter2', 'uw_session=secret', 'Bearer q', '"abc"']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[redacted]');
  });

  it('rotates by size: 10 MB × 10 files', () => {
    expect(rotationOptions('/logs')).toEqual({ path: '/logs', size: '10M', maxFiles: 10 });
  });
});
