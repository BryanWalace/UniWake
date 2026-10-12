/**
 * M23-T04 (FR-406, ADR-052): `--export` next to the service's database and `--import` only with
 * the service stopped, with the exit codes of FR-406.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { DevSecretProtector } from '../src/adapters/secret-protector';
import type { CliIo } from '../src/cli/migration-cli';
import { CONFIG_DEFAULTS } from '../src/config';
import { createHub } from '../src/hub';
import { main } from '../src/main';

const ACTOR = { id: null, label: 'teste' };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'uniwake-cli-'));
  dirs.push(d);
  return d;
};

/** A data folder with a real database (made by a hub that never listens). */
async function dataDir(rooms: string[] = []) {
  const dir = tempDir();
  const hub = await createHub({
    config: { ...CONFIG_DEFAULTS, dataDir: dir, demo: false, panelPort: 0, agentPort: 0 },
    logger: pino({ level: 'silent' }),
    secrets: new DevSecretProtector(),
  });
  for (const name of rooms) hub.services.rooms.create({ name }, ACTOR);
  await hub.stop();
  return dir;
}

function io(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env };
  return { value, out, err };
}

describe('command line (FR-406)', () => {
  it('AC-406-01: --export writes a valid file; secret sections need --password-env', async () => {
    const dir = await dataDir(['Lab CLI']);
    const file = join(tempDir(), 'saida.uniwake');
    const ok = io();
    expect(
      await main(['--export', file, '--data-dir', dir], { io: ok.value }),
      ok.err.join(' '),
    ).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(ok.out.join('\n')).toMatch(
      /Exportado: .*saida\.uniwake \(inventory, schedules, settings/,
    );

    const noPassword = io();
    expect(
      await main(['--export', file, '--sections', 'inventory,users', '--data-dir', dir], {
        io: noPassword.value,
      }),
    ).toBe(2);
    expect(noPassword.err.join(' ')).toMatch(/só podem ser exportados com senha/);

    const withPassword = io({ UNIWAKE_EXPORT_PASSWORD: 'senha-de-teste-aaaa' });
    expect(
      await main(
        [
          '--export',
          file,
          '--sections',
          'inventory,users',
          '--password-env',
          'UNIWAKE_EXPORT_PASSWORD',
          '--data-dir',
          dir,
        ],
        { io: withPassword.value },
      ),
    ).toBe(0);
    const unknown = io();
    expect(
      await main(['--export', file, '--sections', 'tudo', '--data-dir', dir], {
        io: unknown.value,
      }),
    ).toBe(2);
    expect(unknown.err.join(' ')).toMatch(/Parte desconhecida: tudo/);
  });

  it('AC-406-01: --import refuses while a hub answers (exit 3), then imports (exit 0)', async () => {
    const source = await dataDir(['Lab Importado']);
    const file = join(tempDir(), 'a.uniwake');
    expect(await main(['--export', file, '--data-dir', source], { io: io().value })).toBe(0);
    const target = await dataDir();

    const running = io();
    expect(
      await main(['--import', file, '--mode', 'replace', '--data-dir', target], {
        io: running.value,
        hubRunning: () => Promise.resolve(true),
      }),
    ).toBe(3);
    expect(running.err.join(' ')).toMatch(/Pare o serviço UniWake/);

    const done = io();
    expect(
      await main(['--import', file, '--mode', 'replace', '--data-dir', target], {
        io: done.value,
        hubRunning: () => Promise.resolve(false),
      }),
    ).toBe(0);
    expect(done.out.join('\n')).toMatch(/Cadastro: 1 novos/);
    const check = await createHub({
      config: { ...CONFIG_DEFAULTS, dataDir: target, demo: false, panelPort: 0, agentPort: 0 },
      logger: pino({ level: 'silent' }),
      secrets: new DevSecretProtector(),
    });
    expect(check.services.rooms.list().map((r) => r.name)).toEqual(['Lab Importado']);
    expect(check.services.importer.state().standby).not.toBeNull();
    await check.stop();
  });

  it('exit codes: usage 2 (no mode, both flags, no database), damaged file 4', async () => {
    const dir = await dataDir();
    const bad = join(tempDir(), 'ruim.uniwake');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(bad, 'isto não é um backup');
    const notRunning = { hubRunning: () => Promise.resolve(false) };
    expect(
      await main(['--import', bad, '--data-dir', dir], { io: io().value, ...notRunning }),
    ).toBe(2);
    expect(
      await main(['--import', bad, '--export', bad, '--data-dir', dir], { io: io().value }),
    ).toBe(2);
    expect(await main(['--export', bad, '--data-dir', tempDir()], { io: io().value })).toBe(2);
    const damaged = io();
    expect(
      await main(['--import', bad, '--mode', 'merge', '--data-dir', dir], {
        io: damaged.value,
        ...notRunning,
      }),
    ).toBe(4);
    expect(damaged.err.join(' ')).toMatch(/não é um backup do UniWake/);
  });
});
