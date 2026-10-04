import type { Page } from '@playwright/test';
import { demoIp, expect, expectAccessible, randomMac, test, uniq, wakeableMac } from './fixtures';

const roomCard = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Salas' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) });

test.describe('dashboard in demo mode (M4)', () => {
  test('AC-004-09: room cards and "Sem sala" show the right counters', async ({ page, api }) => {
    const names = [uniq('Lab A'), uniq('Lab B'), uniq('Lab C')];
    const rooms: { id: number; name: string }[] = [];
    for (const name of names) {
      rooms.push((await (await api.post('/api/rooms', { data: { name } })).json()) as never);
    }
    const counts = [1, 2, 0];
    for (const [i, room] of rooms.entries()) {
      for (let k = 0; k < counts[i]!; k++) {
        await api.post('/api/devices', {
          data: { name: uniq('PC'), mac: randomMac(), roomId: room.id },
        });
      }
    }
    for (let k = 0; k < 2; k++) {
      await api.post('/api/devices', { data: { name: uniq('Solta'), mac: randomMac() } });
    }
    const dash = (await (await api.get('/api/dashboard')).json()) as {
      noRoom: { online: number; total: number } | null;
    };

    await page.goto('/');
    for (const [i, room] of rooms.entries()) {
      await expect(roomCard(page, room.name)).toContainText(`0/${counts[i]} ligadas`);
    }
    expect(dash.noRoom!.total).toBeGreaterThanOrEqual(2);
    const noRoom = roomCard(page, 'Sem sala');
    await expect(noRoom).toContainText(`${dash.noRoom!.online}/${dash.noRoom!.total} ligadas`);
    // "Sem sala" is the last card.
    await expect(
      page.getByRole('list', { name: 'Salas' }).getByRole('heading', { level: 2 }).last(),
    ).toHaveText('Sem sala');
    await expectAccessible(page);
  });

  test('AC-004-08: a woken room turns online on the open dashboard without a reload', async ({
    page,
    api,
  }) => {
    test.setTimeout(60_000);
    const room = (await (
      await api.post('/api/rooms', { data: { name: uniq('Lab Ao Vivo') } })
    ).json()) as {
      id: number;
      name: string;
    };
    for (let k = 0; k < 2; k++) {
      const r = await api.post('/api/devices', {
        data: { name: uniq('PC'), mac: wakeableMac(), ip: demoIp(), roomId: room.id },
      });
      expect(r.status()).toBe(201);
    }

    await page.goto('/');
    await expect(page.getByText('Atualização ao vivo.')).toBeVisible();
    const card = roomCard(page, room.name);
    await expect(card).toContainText('0/2 ligadas');
    await page.evaluate(() => ((window as unknown as { marker: number }).marker = 42));

    await card.getByRole('button', { name: 'Ligar sala' }).click();
    const dialog = page.getByRole('dialog', { name: `Ligar sala ${room.name}` });
    await dialog.getByRole('button', { name: 'Ligar 2 máquinas' }).click();
    await page.getByRole('button', { name: 'Fechar andamento' }).click();

    // Simulated boot 1–3 s, then verification (every 15 s) pushes the change over SSE.
    await expect(card).toContainText('2/2 ligadas', { timeout: 40_000 });
    expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(42);
  });

  test('AC-004-15: searching "10.0.3.2" lists only matching devices', async ({ page, api }) => {
    const hit = uniq('Busca');
    const miss = uniq('Outra');
    await api.post('/api/devices', { data: { name: hit, mac: randomMac(), ip: '10.0.3.2' } });
    await api.post('/api/devices', { data: { name: miss, mac: randomMac(), ip: '10.0.4.2' } });

    await page.goto('/');
    await expect(page.getByRole('list', { name: 'Salas' })).toBeVisible();
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Buscar máquina' })).toBeFocused();
    await page.keyboard.type('10.0.3.2');
    const results = page.getByRole('region', { name: 'Resultados da busca' });
    await expect(results.getByRole('link', { name: hit })).toBeVisible();
    await expect(results.getByRole('link', { name: miss })).toHaveCount(0);
    for (const row of await results.getByRole('listitem').all()) {
      await expect(row).toContainText('10.0.3.2');
    }
    await expectAccessible(page);
  });

  test('device page: data, uptime and history are reachable and accessible', async ({
    page,
    api,
  }) => {
    const name = uniq('Detalhe');
    const created = (await (
      await api.post('/api/devices', { data: { name, mac: randomMac(), ip: demoIp() } })
    ).json()) as { device: { id: number } };
    await page.goto('/');
    await expect(page.getByRole('searchbox', { name: 'Buscar máquina' })).toBeVisible();
    await page.keyboard.press('/');
    await page.keyboard.type(name);
    await page.getByRole('link', { name }).click();
    await expect(page).toHaveURL(`/dispositivos/${created.device.id}`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Disponibilidade' })).toContainText(
      'Média do período',
    );
    await expect(page.getByRole('region', { name: 'Diagnóstico' })).toContainText(
      'Nunca respondeu',
    );
    await expectAccessible(page);
  });
});
