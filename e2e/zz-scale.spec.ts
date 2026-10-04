/**
 * NFR-01 at scale. Runs last (files run in name order with one worker): it adds 500 devices to the
 * database every spec shares.
 */
import { expect, expectAccessible, test, uniq } from './fixtures';

test('NFR-01: the dashboard with 500 devices is interactive in under 2 s', async ({
  page,
  api,
}) => {
  test.setTimeout(90_000);
  const tag = uniq('Escala');
  const lines = ['nome;mac;ip;sala;tags'];
  for (let i = 0; i < 500; i++) {
    const mac = `02:5C:A1:E0:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`;
    lines.push(`${tag}-${i};${mac};10.30.${i >> 8}.${(i & 255) + 1};${tag} Sala ${i % 10};`);
  }
  const r = await api.post('/api/devices/import/commit', {
    data: { csv: lines.join('\n'), onDuplicate: 'skip', createMissing: true },
  });
  expect(r.status(), await r.text()).toBe(200);

  const started = Date.now();
  await page.goto('/');
  const cards = page.getByRole('list', { name: 'Salas' });
  await expect(cards.getByRole('heading', { name: `${tag} Sala 9` })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar máquina' })).toBeEditable();
  const elapsed = Date.now() - started;
  expect(elapsed, `dashboard ready after ${elapsed} ms`).toBeLessThan(2_000);

  await page.keyboard.press('/');
  await page.keyboard.type(`${tag}-49`);
  await expect(page.getByRole('region', { name: 'Resultados da busca' })).toContainText(
    '11 máquinas encontradas',
  );
  await expectAccessible(page);
});
