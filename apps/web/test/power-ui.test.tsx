import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PowerJob, PowerOccurrence, PowerPreview } from '@uniwake/shared';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const LAB3 = {
  id: 3,
  name: 'Lab 3',
  code: 'LAB3',
  block: null,
  floor: null,
  color: '#2563eb',
  deviceCount: 12,
};

const PREVIEW: PowerPreview = {
  action: 'shutdown',
  count: 10,
  rooms: [{ roomId: 3, name: 'Lab 3', count: 10 }],
  needsConfirmation: false,
  needsPreparation: [
    { deviceId: 11, name: 'PC-11' },
    { deviceId: 12, name: 'PC-12' },
  ],
  revoked: [],
  lost: [],
  withUser: 3,
  offline: 0,
  protected: [],
  policy: { warningMinutes: 1, allowPostpone: false, postponeMax: 0, postponeMinutes: 5 },
};

const JOB: PowerJob = {
  id: 4,
  action: 'shutdown',
  label: 'sala Lab 3',
  createdAt: 1,
  createdBy: 'admin',
  policy: PREVIEW.policy,
  expiresAt: 2,
  counts: {
    pending: 1,
    received: 1,
    confirming: 0,
    done: 1,
    not_confirmed: 0,
    cancelled: 0,
    expired: 0,
    failed: 0,
  },
  devices: [
    { deviceId: 1, name: 'PC-01', state: 'done', postpones: 2, detail: null },
    { deviceId: 2, name: 'PC-02', state: 'received', postpones: 0, detail: null },
    { deviceId: 3, name: 'PC-03', state: 'pending', postpones: 0, detail: null },
  ],
};

function roomApi(): FakeApi {
  return loggedInApi()
    .on('GET', '/api/rooms', { body: [LAB3] })
    .on('GET', '/api/tags', { body: [] })
    .on('GET', '/api/rooms/3', { body: LAB3 })
    .on('GET', '/api/devices', { body: { items: [], total: 0, page: 1, pageSize: 200 } })
    .on('GET', '/api/power/jobs/4', { body: JOB });
}

describe('manual shutdown (FR-305)', () => {
  it('"Desligar" previews ready / v1.2 / logged-on machines, starts with 1 min and opens the progress', async () => {
    const api = roomApi()
      .on('POST', '/api/power/preview', { body: PREVIEW })
      .on('POST', '/api/power/jobs', { status: 202, body: { jobId: 4, count: 10 } })
      .on('POST', '/api/power/jobs/4/cancel', {
        body: {
          ...JOB,
          devices: JOB.devices.map((d) => (d.state === 'done' ? d : { ...d, state: 'cancelled' })),
        },
      });
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Desligar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desligar sala Lab 3' });
    expect(
      await within(dialog).findByText('Vai desligar 10 máquinas em Lab 3 (10).'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/3 máquinas têm alguém usando agora/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/2 máquinas precisam do novo comando.*PC-11, PC-12/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Aviso de 1 minuto; sem adiar.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Desligar 10 máquinas' }));
    const drawer = await screen.findByRole('complementary', { name: 'Andamento do desligamento' });
    expect(
      await within(drawer).findByText('Desligou (adiado 2× pelo usuário)'),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('Recebida — aviso em andamento')).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/api/power/jobs')?.body).toEqual({
      action: 'shutdown',
      target: { type: 'rooms', roomIds: [3], includeNoRoom: false },
      warning: 'short',
      confirmProtected: false,
    });
    await user.click(
      within(drawer).getByRole('button', { name: 'Cancelar o que ainda não executou' }),
    );
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === '/api/power/jobs/4/cancel')).toBe(true),
    );
  });

  it('"5 min com adiamento" asks the preview again and shows the schedules\' policy', async () => {
    const api = roomApi().on('POST', '/api/power/preview', (body) => ({
      body: {
        ...PREVIEW,
        policy:
          (body as { warning: string }).warning === 'standard'
            ? { warningMinutes: 5, allowPostpone: true, postponeMax: 2, postponeMinutes: 15 }
            : PREVIEW.policy,
      },
    }));
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Reiniciar' }));
    await user.click(await screen.findByLabelText('5 min com adiamento (padrão dos agendamentos)'));
    expect(
      await screen.findByText('Aviso de 5 minutos; o usuário pode adiar 2 vezes de 15 min.'),
    ).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === '/api/power/preview').at(-1)?.body).toMatchObject({
      action: 'restart',
      warning: 'standard',
    });
  });

  it('protected machines must be confirmed with the checkbox before starting', async () => {
    roomApi().on('POST', '/api/power/preview', {
      body: { ...PREVIEW, protected: [{ deviceId: 5, name: 'PROF' }] },
    });
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Desligar' }));
    const button = await screen.findByRole('button', { name: 'Desligar 10 máquinas' });
    expect(button).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: /PROF está marcada "Nunca desligar por agendamento"/ }),
    );
    expect(button).toBeEnabled();
  });

  it('shows loading, nothing to do, and errors', async () => {
    let fail = true;
    roomApi().on('POST', '/api/power/preview', () =>
      fail
        ? { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Erro interno inesperado.' } }
        : { body: { ...PREVIEW, count: 0, rooms: [] } },
    );
    const user = userEvent.setup();
    renderApp('/salas/3');
    await user.click(await screen.findByRole('button', { name: 'Desligar' }));
    expect(await screen.findByText('Erro interno inesperado.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Desligar' }));
    expect(await screen.findByText('Nenhuma máquina pronta para desligar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Desligar 0 máquinas$/ })).toBeDisabled();
  });
});

describe('Histórico: shutdowns next to wakes (M19-T04, FR-307)', () => {
  const OCCURRENCE: PowerOccurrence = {
    occurrence: '9:2026-10-12T22:40',
    scheduleId: 9,
    scheduleName: 'Desligar Lab 3 à noite',
    plannedAt: Date.UTC(2026, 9, 12, 22, 40),
    counts: {
      done: 2,
      was_off: 1,
      late_wake: 1,
      cancelled: 0,
      failed: 0,
      probably_done: 1,
      no_report: 0,
      postponed: 1,
    },
    maxPostpones: 2,
    devices: [
      {
        deviceId: 1,
        name: 'PC-01',
        result: 'done',
        postpones: 2,
        wasAsleep: false,
        lateMinutes: null,
        nativeWarning: false,
        userLoggedOn: true,
      },
      {
        deviceId: 2,
        name: 'PC-02',
        result: 'done',
        postpones: 0,
        wasAsleep: true,
        lateMinutes: null,
        nativeWarning: false,
        userLoggedOn: false,
      },
      {
        deviceId: 3,
        name: 'PC-03',
        result: 'was_off',
        postpones: 0,
        wasAsleep: false,
        lateMinutes: null,
        nativeWarning: false,
        userLoggedOn: null,
      },
      {
        deviceId: 4,
        name: 'PC-04',
        result: 'late_wake',
        postpones: 0,
        wasAsleep: true,
        lateMinutes: 75,
        nativeWarning: false,
        userLoggedOn: null,
      },
      {
        deviceId: 5,
        name: 'PC-05',
        result: 'probably_done',
        postpones: 0,
        wasAsleep: false,
        lateMinutes: null,
        nativeWarning: false,
        userLoggedOn: null,
      },
    ],
  };

  function historyApi(history: unknown): FakeApi {
    return loggedInApi()
      .on('GET', '/api/jobs', { body: { items: [], total: 0, page: 1, pageSize: 50 } })
      .on('GET', '/api/schedule-runs', { body: { items: [], total: 0, page: 1, pageSize: 50 } })
      .on('GET', '/api/schedules', { body: [] })
      .on('GET', '/api/rooms', { body: [LAB3] })
      .on('GET', '/api/power/jobs/4', { body: JOB })
      .on('GET', '/api/power/history', history as { body: unknown });
  }

  it('aggregates a scheduled occurrence by outcome and lists manual jobs', async () => {
    historyApi({ body: { occurrences: [OCCURRENCE], jobs: [JOB] } });
    const user = userEvent.setup();
    renderApp('/historico');
    const section = await screen.findByRole('region', { name: 'Desligamentos e reinícios' });
    expect(
      await within(section).findByText(
        '2/5 desligaram, 1 adiou até 2×, 1 provavelmente desligou (sem relatório), 1 estava desligada, 1 acordou atrasada (pulado)',
      ),
    ).toBeInTheDocument();
    expect(section).toHaveTextContent('Desligar Lab 3 à noite');
    expect(section).toHaveTextContent('PC-04: Pulado: acordou 75 min após o horário');
    expect(section).toHaveTextContent('PC-01: Desligou · adiou 2× · havia usuário logado');
    const table = within(section).getByRole('table', { name: /pedidos pelo painel/ });
    expect(table).toHaveTextContent('sala Lab 3');
    expect(table).toHaveTextContent('1/3');
    await user.click(within(table).getByRole('button'));
    expect(
      await screen.findByRole('complementary', { name: 'Andamento do desligamento' }),
    ).toHaveTextContent('PC-02');
  });

  it('shows the empty and error states', async () => {
    historyApi({ body: { occurrences: [], jobs: [] } });
    const { unmount } = renderApp('/historico');
    expect(await screen.findByText('Nenhum desligamento ainda')).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    historyApi({
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Erro interno inesperado.' },
    });
    renderApp('/historico');
    const section = await screen.findByRole('region', { name: 'Desligamentos e reinícios' });
    expect(await within(section).findByText('Erro interno inesperado.')).toBeInTheDocument();
  });
});
