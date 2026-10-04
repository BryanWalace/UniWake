import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, type Config } from '../src/config';
import { createHub, EXIT_CONFIG_ERROR, type Hub, HubStartError } from '../src/hub';
import { main, parseArgs } from '../src/main';

const dirs: string[] = [];
const hubs: Hub[] = [];
afterEach(async () => {
  for (const h of hubs.splice(0)) await h.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function testConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = mkdtempSync(join(tmpdir(), 'uniwake-hub-'));
  dirs.push(dataDir);
  return {
    ...CONFIG_DEFAULTS,
    panelPort: 0,
    agentPort: 0,
    agentBind: '127.0.0.1', // tests never bind all interfaces
    dataDir,
    demo: false,
    ...overrides,
  };
}

const silent = pino({ level: 'silent' });

describe('hub lifecycle (plan §2.1, §9)', () => {
  it('starts both listeners, serves health over real sockets and stops cleanly', async () => {
    const hub = await createHub({ config: testConfig(), logger: silent });
    hubs.push(hub);
    await hub.start();
    const { panel, agent } = hub.addresses();
    expect(panel).toMatch(/^127\.0\.0\.1:\d+$/);
    for (const addr of [panel, agent]) {
      const res = await fetch(`http://${addr}/api/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    }
    // migrations ran against the data dir database
    expect(hub.db.get<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations')?.v).toBe(1);

    await hub.stop();
    expect(hub.db.raw.isOpen).toBe(false);
    await expect(fetch(`http://${panel}/api/health`)).rejects.toThrow();
  });

  it('a port already in use is a startup error with exit code 78 and a clear message', async () => {
    const blocker = net.createServer();
    blocker.listen(0, '127.0.0.1');
    await once(blocker, 'listening');
    const { port } = blocker.address() as net.AddressInfo;
    try {
      const hub = await createHub({ config: testConfig({ panelPort: port }), logger: silent });
      const err = await hub.start().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HubStartError);
      expect((err as HubStartError).exitCode).toBe(EXIT_CONFIG_ERROR);
      expect((err as Error).message).toContain(`port ${port}`);
      expect(hub.db.raw.isOpen).toBe(false); // cleaned up
    } finally {
      blocker.close();
    }
  });

  it('the agent listener accepts any Host; the panel listener does not', async () => {
    const hub = await createHub({ config: testConfig(), logger: silent });
    hubs.push(hub);
    const agent = await hub.agent.inject({
      url: '/api/health',
      headers: { host: '10.0.3.15:47101' },
    });
    expect(agent.statusCode).toBe(200);
    const panel = await hub.panel.inject({
      url: '/api/health',
      headers: { host: '10.0.3.15:47100' },
    });
    expect(panel.statusCode).toBe(421);
  });
});

describe('CLI', () => {
  it('parses flags', () => {
    expect(parseArgs(['--demo', '--data-dir', 'X'])).toEqual({
      demo: true,
      dataDir: 'X',
      version: false,
    });
    expect(parseArgs(['--version']).version).toBe(true);
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['--data-dir'])).toThrow(/requires a path/);
  });

  it('--version prints the version and exits 0; bad args exit 78', async () => {
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const errWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = (s: string) => (out.push(s), true);
    process.stderr.write = (s: string) => (out.push(s), true);
    try {
      expect(await main(['--version'])).toBe(0);
      expect(out.join('')).toMatch(/0\.0\.0-dev/);
      expect(await main(['--bogus'])).toBe(78);
    } finally {
      process.stdout.write = write;
      process.stderr.write = errWrite;
    }
  });
});

describe('demo mode safety (AC-015-01)', () => {
  it('every wake started by a demo hub is a dry run', async () => {
    const hub = await createHub({ config: testConfig({ demo: true }), logger: silent });
    hubs.push(hub);
    const s = hub.services;
    const room = s.rooms.create({ name: 'Lab Demo' }, { id: null, label: 't' });
    s.devices.create(
      { name: 'PC', mac: '00:11:22:33:44:55', roomId: room.id },
      { id: null, label: 't' },
    );
    const { jobId } = s.wake.start(
      { target: { type: 'rooms', roomIds: [room.id], includeNoRoom: false }, onlyOffline: false },
      { id: null, label: 't' },
    );
    expect(s.wake.job(jobId).job.dryRun).toBe(true);
  });
});
