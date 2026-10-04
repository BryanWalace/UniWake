import { expect, randomMac, test, uniq } from './fixtures';

test('AC-004-17: Ctrl+K, "lab 3", Enter shows the preview for Lab 3 like the room card', async ({
  page,
  api,
}) => {
  const name = `Lab 3 ${uniq('E2E')}`;
  const room = (await (await api.post('/api/rooms', { data: { name } })).json()) as { id: number };
  for (let i = 0; i < 2; i++) {
    await api.post('/api/devices', {
      data: { name: uniq('PC'), mac: randomMac(), roomId: room.id },
    });
  }

  await page.goto('/historico'); // works from any page
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Ligar rapidamente' });
  await expect(palette.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('lab 3');
  await expect(palette.getByRole('option', { selected: true })).toContainText(name);
  await page.keyboard.press('Enter');

  const preview = page.getByRole('dialog', { name: `Ligar sala ${name}` });
  await expect(preview.getByText(`Vai ligar 2 máquinas em ${name} (2).`)).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Ligar 2 máquinas' })).toBeVisible();
  await expect(palette).toBeHidden();
});
