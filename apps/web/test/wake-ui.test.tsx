import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const LAB3 = {
  id: 3,
  name: 'Lab 3',
  code: 'LAB3',
  block: null,
  floor: null,
  color: '#2563eb',
  deviceCount: 3,
};
const JOB = {
  job: {
    id: 9,
    source: 'manual',
    requestedBy: 'admin',
    targetLabel: 'sala Lab 3',
    onlyOffline: false,
    dryRun: false,
    state: 'verificando',
    error: null,
    createdAt: Date.UTC(2026, 9, 5, 9, 50),
    startedAt: Date.UTC(2026, 9, 5, 9, 50),
    finishedAt: null,
    verifyUntil: Date.now() + 120_000,
    summary: {
      total: 3,
      woke: 1,
      alreadyOn: 0,
      noResponse: 0,
      sendFailed: 0,
      unverified: 0,
      waiting: 2,
      excluded: 0,
    },
  },
  devices: [
    {
      deviceId: 1,
      name: 'PC-01',
      mac: '00:AA:00:00:00:01',
      roomId: 3,
      result: 'acordou',
      sentAt: 1,
      wokeAt: 2,
    },
    {
      deviceId: 2,
      name: 'PC-02',
      mac: '00:AA:00:00:00:02',
      roomId: 3,
      result: 'aguardando',
      sentAt: 1,
      wokeAt: null,
    },
  ],
};

function roomApi(): FakeApi {
  return loggedInApi()
    .on('GET', '/api/rooms', { body: [LAB3] })
    .on('GET', '/api/tags', { body: [] })
    .on('GET', '/api/rooms/3', { body: LAB3 })
    .on('GET', '/api/devices', { body: { items: [], total: 0, page: 1, pageSize: 200 } })
    .on('GET', '/api/jobs/9', { body: JOB });
}

describe('wake flow (FR-003.3, FR-009)', () => {
  it('"Ligar sala" previews, starts and opens the live progress drawer', async () => {
    const api = roomApi()
      .on('POST', '/api/wake/preview', {
        body: {
          count: 3,
          rooms: [{ roomId: 3, name: 'Lab 3', count: 3 }],
          excluded: [{ deviceId: 7, name: 'X', reason: 'disabled' }],
          needsConfirmation: false,
        },
      })
      .on('POST', '/api/wake', { status: 202, body: { jobId: 9, count: 3, excluded: [] } });
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Ligar sala' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ligar sala Lab 3' });
    expect(
      await within(dialog).findByText('Vai ligar 3 máquinas em Lab 3 (3).'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('1 máquina desativada')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ligar 3 máquinas' }));
    const drawer = await screen.findByRole('complementary', { name: 'Andamento da ligação' });
    expect(
      await within(drawer).findByText(/Verificando — \d+ min \d+ s restantes/),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('2/3')).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/api/wake')?.body).toEqual({
      target: { type: 'rooms', roomIds: [3], includeNoRoom: false },
      onlyOffline: false,
    });
  });

  it('"Ligar só os desligados" sends onlyOffline', async () => {
    const api = roomApi().on('POST', '/api/wake/preview', {
      body: {
        count: 1,
        rooms: [{ roomId: 3, name: 'Lab 3', count: 1 }],
        excluded: [{ deviceId: 1, name: 'PC-01', reason: 'online' }],
        needsConfirmation: false,
      },
    });
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Ligar só os desligados' }));
    expect(await screen.findByText('1 máquina já ligada (não será enviada)')).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/api/wake/preview')?.body).toMatchObject({
      onlyOffline: true,
    });
  });

  it('AC-003-08 large actions show the exact count and send it as confirmation', async () => {
    const api = roomApi()
      .on('POST', '/api/wake/preview', {
        body: {
          count: 45,
          rooms: [{ roomId: 3, name: 'Lab 3', count: 45 }],
          excluded: [],
          needsConfirmation: true,
        },
      })
      .on('POST', '/api/wake', { status: 202, body: { jobId: 9, count: 45, excluded: [] } });
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Ligar sala' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Esta é uma ação grande/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar: ligar 45 máquinas' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.path === '/api/wake')?.body).toMatchObject({
        confirm: { count: 45 },
      }),
    );
  });

  it('if the count changed between preview and start, the new count is shown for confirmation', async () => {
    let previews = 0;
    roomApi()
      .on('POST', '/api/wake/preview', () => {
        previews++;
        return {
          body: {
            count: previews === 1 ? 45 : 46,
            rooms: [{ roomId: 3, name: 'Lab 3', count: previews === 1 ? 45 : 46 }],
            excluded: [],
            needsConfirmation: true,
          },
        };
      })
      .on('POST', '/api/wake', {
        status: 409,
        body: {
          code: 'CONFIRMATION_REQUIRED',
          message: 'Confirme a ação: 46 máquinas serão ligadas.',
        },
      });
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Ligar sala' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar: ligar 45 máquinas' }));
    expect(
      await screen.findByText('A quantidade de máquinas mudou. Confira e confirme novamente.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirmar: ligar 46 máquinas' }),
    ).toBeInTheDocument();
  });

  it('when the room is already being woken, offers to follow the running job', async () => {
    roomApi()
      .on('POST', '/api/wake/preview', {
        body: { count: 3, rooms: [], excluded: [], needsConfirmation: false },
      })
      .on('POST', '/api/wake', {
        status: 409,
        body: {
          code: 'WAKE_ALREADY_RUNNING',
          message: 'Já existe uma ligação em andamento para estas máquinas. Acompanhe o andamento.',
          details: { jobIds: [9] },
        },
      });
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Ligar sala' }));
    await user.click(await screen.findByRole('button', { name: 'Ligar 3 máquinas' }));
    await user.click(
      await screen.findByRole('button', { name: 'Acompanhar ligação em andamento' }),
    );
    expect(
      await screen.findByRole('complementary', { name: 'Andamento da ligação' }),
    ).toBeInTheDocument();
  });

  it('nothing to wake disables the button', async () => {
    roomApi().on('POST', '/api/wake/preview', {
      body: {
        count: 0,
        rooms: [],
        excluded: [{ deviceId: 1, name: 'PC', reason: 'online' }],
        needsConfirmation: false,
      },
    });
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Ligar sala' }));
    expect(await screen.findByText('Nenhuma máquina será ligada.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ligar 0 máquinas$/ })).toBeDisabled();
  });
});

describe('history (FR-009, FR-003.6)', () => {
  it('lists jobs and shows one job with per-device results and its packet log', async () => {
    loggedInApi()
      .on('GET', '/api/jobs', {
        body: { items: [{ ...JOB.job, state: 'concluido' }], total: 1, page: 1, pageSize: 50 },
      })
      .on('GET', '/api/jobs/9', { body: { ...JOB, job: { ...JOB.job, state: 'concluido' } } })
      .on('GET', '/api/jobs/9/packets', {
        body: [
          {
            deviceId: 1,
            mac: '00:AA:00:00:00:01',
            srcIp: '10.0.3.15',
            dstIp: '255.255.255.255',
            port: 9,
            repeat: 0,
            at: 1,
            outcome: 'sent',
            error: null,
          },
        ],
      });
    const user = userEvent.setup();
    renderApp('/historico');
    const row = await screen.findByRole('row', { name: /sala Lab 3/ });
    expect(row).toHaveTextContent('Concluído');
    await user.click(within(row).getByRole('link'));
    expect(
      await screen.findByRole('heading', { level: 1, name: /Ligação #9/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Acordou' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostrar pacotes enviados' }));
    expect(await screen.findByRole('cell', { name: '255.255.255.255' })).toBeInTheDocument();
  });

  it('shows an empty state before the first wake', async () => {
    loggedInApi().on('GET', '/api/jobs', { body: { items: [], total: 0, page: 1, pageSize: 50 } });
    renderApp('/historico');
    expect(await screen.findByText('Nenhuma ligação ainda')).toBeInTheDocument();
  });
});

describe('M3 review fixes (web)', () => {
  it('R-M3-02 a failed job explains what to do next', async () => {
    loggedInApi().on('GET', '/api/jobs/10', {
      body: { ...JOB, job: { ...JOB.job, id: 10, state: 'falhou', error: 'boom' } },
    });
    renderApp('/historico/jobs/10');
    expect(
      await screen.findByText(/erro inesperado\. Veja os logs em Saúde do sistema/),
    ).toBeInTheDocument();
  });
});
