import { demoIp, expect, randomMac, test, uniq, wakeableMac } from './fixtures';

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

test.describe('live job progress (FR-009, demo hub)', () => {
  test('AC-009-01: the drawer updates live and its final counts equal the per-device results', async ({
    page,
    api,
  }) => {
    test.setTimeout(60_000);
    const room = (await (
      await api.post('/api/rooms', { data: { name: uniq('Lab Progresso') } })
    ).json()) as {
      id: number;
      name: string;
    };
    for (let i = 0; i < 3; i++) {
      await api.post('/api/devices', {
        data: { name: uniq('PC'), mac: wakeableMac(), ip: demoIp(), roomId: room.id },
      });
    }
    // No address: "Sem IP para verificar" right away.
    await api.post('/api/devices', {
      data: { name: uniq('SemIP'), mac: wakeableMac(), roomId: room.id },
    });

    await page.goto(`/salas/${room.id}`);
    await page.getByRole('button', { name: 'Ligar sala' }).click();
    await page
      .getByRole('dialog', { name: `Ligar sala ${room.name}` })
      .getByRole('button', { name: 'Ligar 4 máquinas' })
      .click();

    const drawer = page.getByRole('complementary', { name: 'Andamento da ligação' });
    const stat = (label: string) =>
      drawer.locator('dt').getByText(label, { exact: true }).locator('xpath=following-sibling::dd');
    await expect(drawer.getByRole('status')).toContainText('Verificando');
    await expect(stat('Aguardando')).toHaveText('3');
    // Simulated boots (1–3 s) are seen by the first verification round (15 s), pushed over SSE.
    await expect(drawer.getByRole('status')).toContainText('Concluído', { timeout: 40_000 });
    await expect(stat('Aguardando')).toHaveText('0');

    const jobId = Number(
      (await drawer.getByRole('heading', { level: 2 }).textContent())!.replace(/\D/g, ''),
    );
    const detail = (await (await api.get(`/api/jobs/${jobId}`)).json()) as {
      devices: { result: string; sentAt: number | null }[];
    };
    const count = (r: string) => detail.devices.filter((d) => d.result === r).length;
    await expect(stat('Pacotes enviados')).toHaveText(
      `${detail.devices.filter((d) => d.sentAt !== null).length}/4`,
    );
    await expect(stat('Acordaram')).toHaveText(String(count('acordou')));
    await expect(stat('Sem IP para verificar')).toHaveText(String(count('nao_verificado')));
    await expect(stat('Não responderam')).toHaveText(
      String(count('nao_respondeu') + count('falha_no_envio')),
    );
    expect(count('acordou')).toBe(3);
    expect(count('nao_verificado')).toBe(1);
  });
});
