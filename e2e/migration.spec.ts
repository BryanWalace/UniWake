/**
 * M23-T02 (AC-403-06): "Backup e migração" through the UI. The Playwright web server is PC A; this
 * spec starts PC C in-process (panel 27184). Both are demo hubs on loopback: nothing leaves the
 * machine. A exports with a password, C imports the file (Substituir) and ends in standby.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { DevSecretProtector } from '../apps/server/src/adapters/secret-protector';
import { CONFIG_DEFAULTS } from '../apps/server/src/config';
import { createHub, type Hub } from '../apps/server/src/hub';
import { ADMIN, expect, guardConsole, test } from './fixtures';

const C_URL = 'http://127.0.0.1:27184';
const PASSWORD = 'senha-de-teste-aaaa';

let hubC: Hub | null = null;
let dirC = '';

test.beforeAll(async () => {
  dirC = mkdtempSync(join(tmpdir(), 'uniwake-e2e-c-'));
  hubC = await createHub({
    config: {
      ...CONFIG_DEFAULTS,
      dataDir: dirC,
      demo: true,
      demoSeed: false,
      panelPort: 27184,
      agentPort: 27185,
      agentBind: '127.0.0.1',
      syncPort: 27186,
      logLevel: 'warn',
    },
    logger: pino({ level: 'silent' }),
    webDir: join(process.cwd(), 'apps', 'web', 'dist'),
    syncBind: '127.0.0.1',
    secrets: new DevSecretProtector(),
    machineName: 'PC-C',
    teamDefaultPort: 27186,
    teamAnnounceTargets: () => [],
  });
  await hubC.start();
});

test.afterAll(async () => {
  await hubC?.stop();
  rmSync(dirC, { recursive: true, force: true });
});

test('AC-403-06: export with a password on one hub, import it on another with preview', async ({
  page,
  api,
  browser,
}) => {
  expect((await api.post('/api/rooms', { data: { name: 'Lab Migração E2E' } })).status()).toBe(201);

  // PC A: export everything but history, with a password.
  await page.goto('/backup');
  const exportBox = page.getByRole('region', { name: 'Exportar' });
  await exportBox.getByLabel('Senha do arquivo', { exact: true }).fill(PASSWORD);
  await exportBox.getByLabel('Repita a senha').fill(PASSWORD);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportBox.getByRole('button', { name: 'Exportar' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^UniWake-.+\.uniwake$/);
  const file = join(dirC, download.suggestedFilename());
  await download.saveAs(file);

  // PC C: first access, then import with preview and typed confirmation.
  const ctxC = await browser.newContext({ baseURL: C_URL });
  const pageC = await ctxC.newPage();
  const errorsC = guardConsole(pageC);
  expect((await ctxC.request.post('/api/auth/setup', { data: ADMIN })).status()).toBe(201);
  expect((await ctxC.request.post('/api/auth/login', { data: ADMIN })).status()).toBe(200);
  await pageC.goto('/backup');
  const importBox = pageC.getByRole('region', { name: 'Importar' });
  await importBox.getByLabel('Arquivo .uniwake').setInputFiles(file);
  await expect(importBox.getByText('Partes protegidas por senha')).toBeVisible();
  await importBox.getByLabel('Senha do arquivo', { exact: true }).fill(PASSWORD);
  await importBox.getByLabel(/Substituir/).check();
  await importBox.getByRole('button', { name: 'Ver prévia' }).click();
  await expect(importBox.getByRole('table', { name: 'Prévia da importação' })).toBeVisible();
  await importBox.getByLabel('Digite IMPORTAR para confirmar').fill('IMPORTAR');
  await importBox.getByRole('button', { name: 'Importar' }).click();

  // Users were replaced by A's (same account in this run): log in again, then check.
  await expect
    .poll(async () => (await ctxC.request.get('/api/auth/me')).status(), { timeout: 15_000 })
    .toBe(401);
  expect((await ctxC.request.post('/api/auth/login', { data: ADMIN })).status()).toBe(200);
  const rooms = (await (await ctxC.request.get('/api/rooms')).json()) as { name: string }[];
  expect(rooms.map((r) => r.name)).toContain('Lab Migração E2E');
  await pageC.goto('/');
  await expect(pageC.getByText(/Este UniWake está em espera/)).toBeVisible();

  expect(errorsC.filter((e) => !/401/.test(e))).toEqual([]);
  await ctxC.close();
});
