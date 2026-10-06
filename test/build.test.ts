import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, normalizeVersion, testUpdateApi } from '../scripts/build';

const root = join(import.meta.dirname, '..');
let dir: string;
let out: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'uniwake-build-'));
  out = await buildApp({ version: '1.2.3', out: join(dir, 'app'), skipWeb: true });
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('build (M8-T01, ADR-022)', () => {
  it('normalizes the tag into a SemVer version and refuses anything else', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('1.10.0-rc.1')).toBe('1.10.0-rc.1');
    expect(normalizeVersion(undefined)).toBe('0.0.0-dev');
    for (const bad of ['1.2', 'v1.2.3.4', 'latest', '1.2.3; rm']) {
      expect(() => normalizeVersion(bad), bad).toThrow(/SemVer/);
    }
  });

  it('stages one version: bundle, VERSION, prepare script and helpers', () => {
    for (const f of [
      'server.mjs',
      'updater.mjs',
      'VERSION',
      'scripts/prepare-target.ps1',
      'helper/probe-helper.ps1',
      'helper/new-panel-cert.ps1',
    ]) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    expect(readFileSync(join(out, 'VERSION'), 'utf8')).toBe('1.2.3\n');
    // Served to targets byte for byte (the command pins its SHA-256).
    expect(
      readFileSync(join(out, 'scripts/prepare-target.ps1')).equals(
        readFileSync(join(root, 'scripts/prepare-target.ps1')),
      ),
    ).toBe(true);
  });

  it('ADR-025: a release bundle updates from GitHub; only loopback test servers can replace it', () => {
    const bundle = readFileSync(join(out, 'server.mjs'), 'utf8');
    expect(bundle).toContain('https://api.github.com');
    expect(bundle).toContain('BryanWalace/UniWake');
    expect(testUpdateApi(undefined)).toBeUndefined();
    expect(testUpdateApi('http://127.0.0.1:47199')).toBe('http://127.0.0.1:47199');
    for (const bad of ['https://api.github.com', 'http://10.0.0.5:80', 'http://127.0.0.1:1/x']) {
      expect(() => testUpdateApi(bad), bad).toThrow(/127.0.0.1|127.0.0.1/);
    }
  });

  it('the bundle reports the embedded version (node server.mjs --version)', () => {
    expect(
      execFileSync(process.execPath, [join(out, 'server.mjs'), '--version'], { encoding: 'utf8' }),
    ).toBe('1.2.3\n');
  });

  it('the bundle starts a demo hub that answers health and serves the prepare script', async () => {
    const [panel, agent] = [await freePort(), await freePort()];
    const child = spawn(
      process.execPath,
      [join(out, 'server.mjs'), '--demo', '--data-dir', join(dir, 'data')],
      {
        env: {
          ...process.env,
          UNIWAKE_PANEL_PORT: String(panel),
          UNIWAKE_AGENT_PORT: String(agent),
          UNIWAKE_AGENT_BIND: '127.0.0.1',
          UNIWAKE_LOG_LEVEL: 'warn',
          UNIWAKE_DEMO_SEED: '0',
        },
        stdio: 'ignore',
      },
    );
    try {
      let health: unknown = null;
      for (let i = 0; i < 100 && health === null; i++) {
        health = await fetch(`http://127.0.0.1:${panel}/api/health`)
          .then((r) => r.json())
          .catch(() => null);
        if (health === null) await new Promise((r) => setTimeout(r, 200));
      }
      expect(health).toEqual({ status: 'ok' });
      const script = await fetch(`http://127.0.0.1:${agent}/agent/prepare-target.ps1`);
      expect(
        Buffer.from(await script.arrayBuffer()).equals(
          readFileSync(join(out, 'scripts/prepare-target.ps1')),
        ),
      ).toBe(true);
    } finally {
      child.kill();
      await new Promise((r) => child.once('exit', r));
    }
  }, 60_000);
});
