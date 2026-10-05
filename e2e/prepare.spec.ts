/** "Preparar máquinas" against the demo hub (FR-007.3, ADR-011). */
import { createHash } from 'node:crypto';
import { expect, expectAccessible, test, uniq } from './fixtures';

/** The E2E hub's agent listener (scripts/e2e-server.ts). */
const AGENT = 'http://127.0.0.1:47191';

test('AC-007-13: the command pins the SHA-256 of the script the agent listener serves', async ({
  page,
  api,
  request,
}) => {
  const name = uniq('Lab Preparo');
  const room = (await (await api.post('/api/rooms', { data: { name } })).json()) as {
    code: string;
  };
  await page.goto('/preparar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Preparar máquinas');
  await page.getByLabel('Sala').selectOption({ label: `${name} (${room.code})` });
  await page.getByRole('button', { name: 'Gerar código' }).click();
  const box = page.getByLabel('Comando (PowerShell como Administrador)');
  await expect(box).toHaveValue(/-RoomCode '[A-Z0-9-]+' -Token '[A-Za-z0-9_-]+'/);
  const command = await box.inputValue();
  const pinned = /-ne '([0-9A-F]{64})'/.exec(command)?.[1];
  const served = await request.get(`${AGENT}/agent/prepare-target.ps1`);
  expect(served.status()).toBe(200);
  expect(
    createHash('sha256')
      .update(await served.body())
      .digest('hex')
      .toUpperCase(),
  ).toBe(pinned);
  await expectAccessible(page);
  // The new code is listed as active with no uses yet.
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('0 de 100');
  await expect(row).toContainText('Ativo');
});
