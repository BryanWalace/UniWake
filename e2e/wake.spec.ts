import { expect, randomMac, test, uniq } from './fixtures';

test.describe('wake flow in the browser (M3, dry-run hub)', () => {
  test('waking a room shows the preview, the live drawer and the job in the history', async ({
    page,
    api,
  }) => {
    const room = (await (await api.post('/api/rooms', { data: { name: uniq('Lab') } })).json()) as {
      id: number;
      name: string;
    };
    for (let i = 0; i < 2; i++) {
      await api.post('/api/devices', {
        data: { name: uniq('PC'), mac: randomMac(), roomId: room.id },
      });
    }
    await page.goto(`/salas/${room.id}`);
    await page.getByRole('button', { name: 'Ligar sala' }).click();
    const dialog = page.getByRole('dialog', { name: `Ligar sala ${room.name}` });
    await expect(dialog.getByText(`Vai ligar 2 máquinas em ${room.name} (2).`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Ligar 2 máquinas' }).click();

    const drawer = page.getByRole('complementary', { name: 'Andamento da ligação' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('simulação')).toBeVisible();

    await page.goto('/historico');
    await expect(page.getByRole('row', { name: new RegExp(`sala ${room.name}`) })).toBeVisible();
  });
});
