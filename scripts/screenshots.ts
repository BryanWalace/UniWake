/**
 * README screenshots (docs/screenshots/*.png) taken from demo hubs: simulated network and fictitious
 * data only, never an institution's real IPs, MACs, names or enrollment codes.
 * Run: npm run build && node --import tsx scripts/screenshots.ts
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import pino from 'pino';
import { DevSecretProtector } from '../apps/server/src/adapters/secret-protector.ts';
import { CONFIG_DEFAULTS } from '../apps/server/src/config.ts';
import { createHub, type Hub } from '../apps/server/src/hub.ts';

const OUT = join(process.cwd(), 'docs', 'screenshots');
const WEB = join(process.cwd(), 'apps', 'web', 'dist');
const ADMIN = { username: 'admin', password: 'senha-demo-12345' };

async function demoHub(name: string, panel: number, sync: number, other: number, seed: boolean) {
  const dir = mkdtempSync(join(tmpdir(), `uw-shots-${name}-`));
  const hub = await createHub({
    config: {
      ...CONFIG_DEFAULTS,
      dataDir: dir,
      demo: true,
      demoSeed: seed,
      demoWakeDelayMs: [3_000, 9_000],
      panelPort: panel,
      agentPort: panel + 1,
      agentBind: '127.0.0.1',
      syncPort: sync,
    },
    logger: pino({ level: 'silent' }),
    webDir: WEB,
    prepareScriptPath: join(process.cwd(), 'scripts', 'prepare-target.ps1'),
    syncBind: '127.0.0.1',
    secrets: new DevSecretProtector(),
    machineName: name,
    teamDefaultPort: other,
    teamAnnounceTargets: () => [{ host: '127.0.0.1', port: other }],
  });
  await hub.start();
  return { hub, dir, base: `http://127.0.0.1:${panel}` };
}

async function login(page: Page, base: string) {
  const status = (await (await page.request.get(`${base}/api/auth/setup-status`)).json()) as {
    needsSetup: boolean;
  };
  if (status.needsSetup) await page.request.post(`${base}/api/auth/setup`, { data: ADMIN });
  const ok = await page.request.post(`${base}/api/auth/login`, { data: ADMIN });
  if (ok.status() !== 200) throw new Error(`login failed on ${base}`);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`docs/screenshots/${name}.png`);
}

mkdirSync(OUT, { recursive: true });
const hubs: { hub: Hub; dir: string }[] = [];
const browser = await chromium.launch();
try {
  const a = await demoHub('TI-MANHA', 47390, 47392, 47396, true);
  const b = await demoHub('TI-TARDE', 47394, 47396, 47392, false);
  hubs.push(a, b);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  const page = await ctx.newPage();
  await login(page, a.base);

  await page.goto(`${a.base}/`);
  await page.getByRole('heading', { level: 1, name: 'Painel' }).waitFor();
  await shot(page, 'painel');

  await page.goto(`${a.base}/salas`);
  await page.getByRole('link', { name: 'Laboratório 1' }).first().click();
  await page.getByRole('button', { name: 'Ligar sala' }).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Ligar/ });
  await confirm.last().click();
  await page.waitForTimeout(6_000);
  await shot(page, 'ligar-sala');

  await page.goto(`${a.base}/preparar`);
  await page.getByLabel('Sala').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Gerar código' }).click();
  await page.getByText('Comando (PowerShell como Administrador)').waitFor();
  await shot(page, 'preparar');

  await page.goto(`${a.base}/historico`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await shot(page, 'historico');

  // Modo equipe: TI-TARDE joins TI-MANHA's team, then the members list.
  const pairing = (await (
    await page.request.post(`${a.base}/api/team/pairing`, {
      headers: { origin: a.base },
    })
  ).json()) as { pairing: { code: string } };
  const pageB = await (await browser.newContext()).newPage();
  await login(pageB, b.base);
  const joined = await pageB.request.post(`${b.base}/api/team/join`, {
    headers: { origin: b.base },
    data: { address: '127.0.0.1', code: pairing.pairing.code },
  });
  if (joined.status() !== 200) throw new Error(`join failed: ${await joined.text()}`);
  await page.goto(`${a.base}/equipe`);
  await page.getByText('TI-TARDE').waitFor();
  await page.waitForTimeout(2_000);
  await page.reload();
  await page.getByText('TI-TARDE').waitFor();
  await shot(page, 'modo-equipe');
} finally {
  await browser.close();
  for (const h of hubs) {
    await h.hub.stop();
    rmSync(h.dir, { recursive: true, force: true });
  }
}
