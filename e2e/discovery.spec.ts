/** Network discovery on the demo hub (FR-101): unregistered demo machines live in 10.20.200.0/24. */
import { expect, expectAccessible, test, uniq } from './fixtures';

test('AC-101-03 end to end: discover machines, add one to a room, then it is "já cadastrado"', async ({
  page,
  api,
}) => {
  const name = uniq('Sala Nova');
  await api.post('/api/rooms', { data: { name } });
  await page.goto('/dispositivos/descobrir');
  await page.getByLabel('Ou parte dela').fill('10.20.200.0/24');
  await page.getByRole('button', { name: 'Varrer rede' }).click();
  const table = page.getByRole('table', { name: 'Computadores encontrados' });
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expectAccessible(page);
  const row = table.getByRole('row').filter({ hasText: '10.20.200.11' });
  if (await row.getByRole('checkbox').count()) {
    await row.getByRole('checkbox').check();
    await expect(row.getByLabel('Nome de 10.20.200.11')).toHaveValue('SALA-NOVA-PC01');
    await page.getByLabel('Sala').selectOption({ label: name });
    await page.getByRole('button', { name: /Adicionar 1 selecionado/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'adicionado' })).toBeVisible();
  }
  await expect(row).toContainText('já cadastrado');
});
