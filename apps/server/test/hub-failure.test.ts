import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileLogger, LOG_FILE } from '../src/adapters/logger';
import { CONFIG_DEFAULTS, dataPaths } from '../src/config';
import type * as PanelModule from '../src/http/panel';

vi.mock('../src/http/panel', async (orig) => {
  const real = await orig<typeof PanelModule>();
  return {
    ...real,
    registerAgentRoutes: () => {
      throw new Error('agent route registration failed');
    },
  };
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'uniwake-fail-'));
  dirs.push(d);
  return d;
};

describe('R-M1-01: createHub cleans up when building a listener fails', () => {
  it('closes the database so the file is not left locked', async () => {
    const { createHub } = await import('../src/hub');
    const dir = temp();
    await expect(
      createHub({
        config: { ...CONFIG_DEFAULTS, dataDir: dir, demo: false, panelPort: 0, agentPort: 0 },
      }),
    ).rejects.toThrow('agent route registration failed');
    const dbFile = dataPaths(dir).db;
    expect(existsSync(dbFile)).toBe(true);
    // On Windows an open handle makes this throw EPERM/EBUSY.
    expect(() => rmSync(dbFile)).not.toThrow();
  });
});

describe('R-M1-02: file logger flushes on close', () => {
  it('writes every line before close resolves and ignores logs after close', async () => {
    const dir = temp();
    const fileLogger = createFileLogger(dir, 'info');
    const { logger } = fileLogger;
    for (let i = 0; i < 200; i++) logger.info({ i }, 'line');
    logger.info({}, 'UniWake hub stopped');
    await fileLogger.close();
    const text = readFileSync(join(dir, LOG_FILE), 'utf8');
    expect(text.trim().split('\n')).toHaveLength(201);
    expect(text).toContain('UniWake hub stopped');
    expect(() => logger.error({}, 'late line')).not.toThrow();
    await fileLogger.close(); // idempotent
  });
});
