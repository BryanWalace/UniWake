/** NFR-07 sweep (M6-T12): no serious or critical axe violations on the main pages. */
import { expect, expectAccessible, randomMac, test, uniq } from './fixtures';

test.describe('accessibility sweep (NFR-07)', () => {
  test('login page', async ({ anonymousPage: page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    await expectAccessible(page);
  });

  test('every main page as admin', async ({ page, api }) => {
    test.setTimeout(90_000);
    const room = (await (
      await api.post('/api/rooms', { data: { name: uniq('Lab Axe') } })
    ).json()) as {
      id: number;
    };
    await api.post('/api/devices', {
      data: { name: uniq('PC'), mac: randomMac(), roomId: room.id },
    });
    await api.post('/api/schedules', {
      data: {
        name: uniq('Manhã'),
        weekdays: 31,
        timeLocal: '06:50',
        target: { type: 'rooms', roomIds: [room.id] },
      },
    });
    for (const [path, heading] of [
      ['/', 'Painel'],
      ['/salas', 'Salas'],
      [`/salas/${room.id}`, null],
      ['/dispositivos', null],
      ['/agendamentos', 'Agendamentos'],
      ['/preparar', 'Preparar máquinas'],
      ['/historico', null],
      ['/configuracoes', 'Configurações'],
      ['/usuarios', 'Usuários'],
      ['/auditoria', 'Auditoria'],
      ['/saude', 'Saúde do sistema'],
      ['/logs', 'Logs do serviço'],
    ] as const) {
      await page.goto(path);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1, path).toBeVisible();
      if (heading) await expect(h1).toHaveText(heading);
      await expectAccessible(page);
    }
  });

  test('schedule form and settings with the dialogs open', async ({ page }) => {
    await page.goto('/agendamentos');
    await page.getByRole('button', { name: 'Novo agendamento' }).click();
    await expect(page.getByRole('dialog', { name: 'Novo agendamento' })).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Pausar agendamentos' }).click();
    await expect(page.getByRole('dialog', { name: 'Pausar agendamentos' })).toBeVisible();
    await expectAccessible(page);
  });
});
