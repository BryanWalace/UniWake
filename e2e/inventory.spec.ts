import { expect, expectAccessible, randomMac, test, uniq } from './fixtures';

test.describe('devices, rooms and tags in the browser (M2-T14)', () => {
  test('AC-002-06 a second device with the same name is saved and the UI warns', async ({
    page,
    api,
  }) => {
    const name = uniq('PC');
    const first = await api.post('/api/devices', { data: { name, mac: randomMac() } });
    expect(first.status()).toBe(201);

    await page.goto('/dispositivos');
    await page.getByRole('button', { name: 'Novo dispositivo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo dispositivo' });
    await dialog.getByLabel('Nome', { exact: true }).fill(name);
    await dialog.getByLabel(/^MAC/).fill(randomMac().replace(/:/g, '-').toLowerCase());
    await dialog.getByRole('button', { name: 'Salvar' }).click();

    await expect(page.getByText('Já existe outro dispositivo com este nome.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await page.getByLabel('Buscar').fill(name);
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(2);
  });

  test('AC-008-05 a room page opened directly renders its devices and buttons', async ({
    page,
    api,
  }) => {
    const room = (await (await api.post('/api/rooms', { data: { name: uniq('Lab') } })).json()) as {
      id: number;
      name: string;
    };
    const dev = uniq('PC');
    await api.post('/api/devices', { data: { name: dev, mac: randomMac(), roomId: room.id } });

    await page.goto(`/salas/${room.id}`);
    await expect(page.getByRole('heading', { level: 1, name: room.name })).toBeVisible();
    await expect(page.getByRole('cell', { name: dev, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar máquina' })).toBeVisible();
    await expect(page.getByText('0/1 ligadas')).toBeVisible();
  });

  test('creates a room, moves a device into it in bulk and deletes the room with confirmation', async ({
    page,
    api,
  }) => {
    const dev = uniq('PC');
    await api.post('/api/devices', { data: { name: dev, mac: randomMac() } });
    const roomName = uniq('Sala');

    await page.goto('/salas');
    await page.getByRole('button', { name: 'Nova sala' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova sala' });
    await dialog.getByLabel('Nome', { exact: true }).fill(roomName);
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText(new RegExp(`Sala "${roomName}" salva`))).toBeVisible();

    await page.goto('/dispositivos');
    await page.getByLabel('Buscar').fill(dev);
    await page.getByLabel(`Selecionar ${dev}`).check();
    const bar = page.getByRole('region', { name: 'Ações em lote' });
    await bar.getByLabel('Mover para').selectOption({ label: roomName });
    await bar.getByRole('button', { name: 'Mover' }).click();
    await expect(page.getByText('1 dispositivo(s) movido(s).')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: dev })).toContainText(roomName);

    await page.goto('/salas');
    await page.getByRole('button', { name: `Excluir sala ${roomName}` }).click();
    const confirm = page.getByRole('dialog', { name: 'Excluir sala' });
    await expect(confirm).toContainText('1 máquina(s) irão para "Sem sala".');
    await confirm.getByRole('button', { name: 'Excluir' }).click();
    await expect(page.getByText(`Sala "${roomName}" excluída.`)).toBeVisible();
  });

  test('NFR-07 devices, rooms and room pages have no serious accessibility violations', async ({
    page,
    api,
  }) => {
    const room = (await (
      await api.post('/api/rooms', { data: { name: uniq('A11y') } })
    ).json()) as { id: number };
    await api.post('/api/devices', {
      data: { name: uniq('PC'), mac: randomMac(), roomId: room.id },
    });
    for (const path of ['/dispositivos', '/salas', `/salas/${room.id}`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page);
    }
  });
});
