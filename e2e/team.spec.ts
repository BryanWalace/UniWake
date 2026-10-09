/**
 * M14-T05: Modo equipe through the UI with two hubs on loopback. The Playwright web server is PC A
 * (panel 47190, team port 47192); this spec starts PC B in-process (panel 47194, team port 47196).
 * Both are demo hubs: no magic packet leaves the machine and nothing is broadcast on the LAN.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { DevSecretProtector } from '../apps/server/src/adapters/secret-protector';
import { CONFIG_DEFAULTS } from '../apps/server/src/config';
import { createHub, type Hub } from '../apps/server/src/hub';
import { ADMIN, expect, guardConsole, test } from './fixtures';

const B_URL = 'http://127.0.0.1:47194';

let hubB: Hub | null = null;
let dirB = '';

test.beforeAll(async () => {
  dirB = mkdtempSync(join(tmpdir(), 'uniwake-e2e-b-'));
  hubB = await createHub({
    config: {
      ...CONFIG_DEFAULTS,
      dataDir: dirB,
      demo: true,
      demoSeed: false,
      panelPort: 47194,
      agentPort: 47195,
      agentBind: '127.0.0.1',
      syncPort: 47196,
      logLevel: 'warn',
    },
    logger: pino({ level: 'silent' }),
    webDir: join(process.cwd(), 'apps', 'web', 'dist'),
    syncBind: '127.0.0.1',
    secrets: new DevSecretProtector(),
    machineName: 'PC-B',
    // PC A listens on 47192: typing "127.0.0.1" on B reaches it, and announcements stay local.
    teamDefaultPort: 47192,
    teamAnnounceTargets: () => [{ host: '127.0.0.1', port: 47192 }],
  });
  await hubB.start();
});

test.afterAll(async () => {
  await hubB?.stop();
  rmSync(dirB, { recursive: true, force: true });
});

test('pair two PCs in the panel and see a room appear on the other one (FR-201, FR-202)', async ({
  page,
  api,
  browser,
}) => {
  // PC A has a room before pairing.
  expect((await api.post('/api/rooms', { data: { name: 'Lab Equipe E2E' } })).status()).toBe(201);

  // PC A: generate the code.
  await page.goto('/equipe');
  await page.getByRole('button', { name: 'Gerar código de pareamento' }).click();
  const code = (await page.getByLabel('Código de pareamento').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);

  // PC B: its own first access, then join A's team.
  const ctxB = await browser.newContext({ baseURL: B_URL });
  const pageB = await ctxB.newPage();
  const errorsB = guardConsole(pageB);
  expect((await ctxB.request.post('/api/auth/setup', { data: ADMIN })).status()).toBe(201);
  expect((await ctxB.request.post('/api/auth/login', { data: ADMIN })).status()).toBe(200);
  await pageB.goto('/equipe');
  await pageB.getByLabel('Endereço do outro PC').fill('127.0.0.1');
  await pageB.getByLabel('Código de 6 dígitos').fill(code);
  await pageB.getByRole('button', { name: 'Entrar na equipe' }).click();

  // B's users were replaced by the team's: log in with the team account (same in this run).
  await expect(pageB).toHaveURL(/\/login/, { timeout: 15_000 });
  await pageB.getByLabel('Usuário').fill(ADMIN.username);
  await pageB.getByLabel('Senha').fill(ADMIN.password);
  await pageB.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(pageB).not.toHaveURL(/\/login/, { timeout: 15_000 });
  await pageB.goto('/salas');
  await expect(pageB.getByRole('link', { name: 'Lab Equipe E2E' })).toBeVisible();

  // B → A: a room created on B appears on A (B pokes A within seconds).
  expect(
    (await ctxB.request.post('/api/rooms', { data: { name: 'Sala criada no B' } })).status(),
  ).toBe(201);
  await expect
    .poll(
      async () =>
        ((await (await api.get('/api/rooms')).json()) as { name: string }[]).map((r) => r.name),
      { timeout: 20_000 },
    )
    .toContain('Sala criada no B');
  await page.goto('/equipe');
  await expect(page.getByRole('cell', { name: /PC-B/ })).toBeVisible();

  expect(errorsB).toEqual([]);
  await ctxB.close();
  // Leave the team so the remaining specs run on a standalone hub.
  expect((await api.post('/api/team/leave')).status()).toBe(200);
});
