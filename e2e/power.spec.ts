import { expect, randomMac, test, uniq } from './fixtures';

/**
 * v1.3 shutdown in the browser against the demo hub (FR-305, FR-306, FR-310): simulated agents
 * receive orders in-process; nothing real is shut down (demo mode forces the simulator).
 */
test.describe('manual shutdown (FR-305, demo hub)', () => {
  test('AC-305-03: "Desligar" on a room shows the machines receiving, one postponing and the rest shutting down', async ({
    page,
    api,
  }) => {
    test.setTimeout(60_000);
    const room = (await (
      await api.post('/api/rooms', { data: { name: uniq('Lab Desligar') } })
    ).json()) as {
      id: number;
      name: string;
    };
    const names = [uniq('PC'), uniq('PC'), uniq('PC-ADIA'), uniq('PC-V12')];
    const ids: number[] = [];
    for (const name of names) {
      const r = await api.post('/api/devices', {
        data: { name, mac: randomMac(), roomId: room.id },
      });
      ids.push(((await r.json()) as { device: { id: number } }).device.id);
    }
    // The simulated agents check in every 2 s; wait until this room's three prepared ones are ready.
    await expect
      .poll(
        async () => {
          const agents = (await (await api.get('/api/power/agents')).json()) as {
            deviceId: number;
            readiness: string;
          }[];
          return agents.filter((a) => ids.includes(a.deviceId) && a.readiness === 'ready').length;
        },
        { timeout: 15_000 },
      )
      .toBe(3);

    await page.goto(`/salas/${room.id}`);
    await page.getByRole('button', { name: 'Desligar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Desligar sala ${room.name}` });
    await expect(dialog.getByText(`Vai desligar 3 máquinas em ${room.name} (3).`)).toBeVisible();
    await expect(dialog.getByText(/1 máquina precisa do novo comando/)).toBeVisible();
    await dialog.getByLabel('5 min com adiamento (padrão dos agendamentos)').check();
    await dialog.getByRole('button', { name: 'Desligar 3 máquinas' }).click();

    const drawer = page.getByRole('complementary', { name: 'Andamento do desligamento' });
    const row = (name: string) => drawer.getByRole('listitem').filter({ hasText: name });
    // The postponing machine is still in its warning while the others have shut down.
    await expect(row(names[2]!)).toContainText('Recebida — aviso em andamento', {
      timeout: 15_000,
    });
    await expect(row(names[0]!)).toContainText(/Desligou|Desligando/, { timeout: 15_000 });
    await expect(row(names[1]!)).toContainText(/Desligou|Desligando/);
    await expect(row(names[2]!)).toContainText('adiado 2× pelo usuário', { timeout: 20_000 });
  });
});

test.describe('schedules with "Desligar" (FR-306, demo hub)', () => {
  test('AC-306-02: a "Desligar" schedule lists its next runs and shows its action', async ({
    page,
    api,
  }) => {
    const room = (await (
      await api.post('/api/rooms', { data: { name: uniq('Lab Noite') } })
    ).json()) as {
      id: number;
      name: string;
    };
    await api.post('/api/devices', {
      data: { name: uniq('PC'), mac: randomMac(), roomId: room.id },
    });
    const name = uniq('Desligar noite');
    await page.goto('/agendamentos');
    await page.getByRole('button', { name: 'Novo agendamento' }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo agendamento' });
    await dialog.getByRole('radio', { name: 'Desligar' }).check();
    await dialog.getByLabel('Nome').fill(name);
    await dialog.getByLabel('Horário', { exact: true }).fill('22:40');
    await dialog.getByRole('checkbox', { name: new RegExp(room.name) }).check();
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText(`Agendamento "${name}" salvo.`)).toBeVisible();

    const item = page.getByRole('listitem').filter({ hasText: name });
    await expect(item.getByText('Desligar', { exact: true })).toBeVisible();
    await expect(item.getByText(/aviso de 5 min, até 2× adiar 15 min/)).toBeVisible();
    await expect(item.getByText(/próxima: /)).toBeVisible();
  });
});
