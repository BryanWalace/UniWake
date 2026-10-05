import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dashboard, EnrollmentMoves, MorningResult } from '@uniwake/shared';
import { loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const DASH: Dashboard = {
  counters: { online: 0, offline: 0, desconhecido: 0, total: 0 },
  rooms: [],
  noRoom: null,
  tags: [],
  notices: [],
  demo: false,
  dryRun: false,
  lastSweepAt: null,
  pause: null,
};
const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m).getTime();

describe('pause (FR-005.6)', () => {
  it('a red banner on every page says why and until when; "Retomar agora" resumes', async () => {
    const api = loggedInApi()
      .on('GET', '/api/dashboard', {
        body: {
          ...DASH,
          pause: { since: at(8), reason: 'Férias de julho', resumeAt: at(23, 59), by: 'ana' },
        },
      })
      .on('GET', '/api/rooms', { body: [] })
      .on('GET', '/api/tags', { body: [] })
      .on('POST', '/api/scheduler/resume', { status: 204 });
    const user = userEvent.setup();
    renderApp('/salas');
    const banner = (await screen.findByText('Agendamentos pausados:')).closest(
      '[role=alert]',
    ) as HTMLElement;
    expect(banner).toHaveTextContent('Agendamentos pausados: Férias de julho');
    expect(banner).toHaveTextContent('por ana');
    expect(banner).toHaveTextContent('retomam sozinhos em 05/10/2026 23:59');
    await user.click(within(banner).getByRole('button', { name: 'Retomar agora' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === '/api/scheduler/resume')).toBe(true),
    );
  });

  it('AC-005-09 in the UI: pausing without a reason shows the message under the field', async () => {
    const posts: unknown[] = [];
    loggedInApi()
      .on('GET', '/api/dashboard', { body: DASH })
      .on('GET', '/api/schedules', { body: [] })
      .on('GET', '/api/schedule-exceptions', { body: [] })
      .on('POST', '/api/scheduler/pause', (body) => {
        posts.push(body);
        return (body as { reason: string }).reason.trim()
          ? { body: { since: at(9), reason: 'Rede', resumeAt: null, by: 'admin' } }
          : {
              status: 422,
              body: {
                code: 'PAUSE_REASON_REQUIRED',
                message: 'Informe o motivo da pausa (ex.: "Férias de julho").',
              },
            };
      });
    const user = userEvent.setup();
    renderApp('/agendamentos');
    await user.click(await screen.findByRole('button', { name: 'Pausar agendamentos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pausar agendamentos' });
    await user.click(within(dialog).getByRole('button', { name: 'Pausar' }));
    expect(await within(dialog).findByText(/Informe o motivo da pausa/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Motivo'), 'Rede');
    await user.click(within(dialog).getByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posts.at(-1)).toEqual({ reason: 'Rede', resumeAt: null });
  });
});

describe('holidays (FR-005.2)', () => {
  it('lists exceptions, adds one for every schedule and deletes', async () => {
    const api = loggedInApi()
      .on('GET', '/api/dashboard', { body: DASH })
      .on('GET', '/api/schedules', { body: [] })
      .on('GET', '/api/schedule-exceptions', {
        body: [
          {
            id: 4,
            scheduleId: null,
            startDate: '2026-12-21',
            endDate: '2027-01-31',
            description: 'Férias',
          },
        ],
      })
      .on('POST', '/api/schedule-exceptions', { status: 201, body: {} })
      .on('DELETE', '/api/schedule-exceptions/4', { status: 204 });
    const user = userEvent.setup();
    renderApp('/agendamentos');
    const list = await screen.findByRole('list', { name: 'Feriados' });
    expect(list).toHaveTextContent('21/12/2026 a 31/01/2027');
    expect(list).toHaveTextContent('Todos os agendamentos');
    const form = screen.getByRole('form', { name: 'Novo feriado' });
    await user.type(within(form).getByLabelText('Início'), '2026-11-20');
    await user.type(within(form).getByLabelText('Descrição'), 'Consciência Negra');
    await user.click(within(form).getByRole('button', { name: 'Adicionar' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
        startDate: '2026-11-20',
        description: 'Consciência Negra',
        scheduleId: null,
      }),
    );
    await user.click(within(list).getByRole('button', { name: 'Excluir Férias' }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('execution log (FR-005.7)', () => {
  it('shows each run with its pt-BR status, detail and job link', async () => {
    loggedInApi()
      .on('GET', '/api/jobs', { body: { items: [], total: 0, page: 1, pageSize: 50 } })
      .on('GET', '/api/schedule-runs', {
        body: {
          items: [
            {
              id: 2,
              scheduleId: 1,
              scheduleName: 'Manhã',
              plannedAt: at(6, 50),
              handledAt: at(6, 58),
              status: 'atrasado',
              detail: 'atrasado (8 min)',
              jobId: 9,
            },
            {
              id: 1,
              scheduleId: 1,
              scheduleName: 'Manhã',
              plannedAt: at(6, 50) - 86_400_000,
              handledAt: 0,
              status: 'pulado_feriado',
              detail: 'Consciência Negra',
              jobId: null,
            },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        },
      });
    renderApp('/historico');
    const table = await screen.findByRole('table', { name: 'Execuções dos agendamentos' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Atrasado');
    expect(rows[0]).toHaveTextContent('atrasado (8 min)');
    expect(within(rows[0]!).getByRole('link', { name: '#9' })).toHaveAttribute(
      'href',
      '/historico/jobs/9',
    );
    expect(rows[1]).toHaveTextContent('Pulado (feriado)');
    expect(rows[1]).toHaveTextContent('Consciência Negra');
  });
});

describe('morning result (FR-013)', () => {
  it('AC-013-01: the card lists the non-responders per room and "Ciente" acknowledges it', async () => {
    const data: MorningResult = {
      day: '2026-10-05',
      runs: [
        {
          scheduleId: 1,
          scheduleName: 'Abertura',
          plannedAt: at(6, 50),
          status: 'executado',
          detail: null,
          jobId: 9,
          total: 30,
          woke: 28,
          notWoken: [
            {
              roomId: 1,
              roomName: 'Lab 1',
              devices: [
                { id: 11, name: 'LAB1-PC11', result: 'nao_respondeu' },
                { id: 12, name: 'LAB1-PC12', result: 'nao_respondeu' },
              ],
            },
          ],
        },
      ],
    };
    const api = loggedInApi()
      .on('GET', '/api/dashboard', {
        body: { ...DASH, notices: [{ id: 3, type: 'morning_result', createdAt: at(7), data }] },
      })
      .on('POST', '/api/notices/3/ack', { status: 204 });
    const user = userEvent.setup();
    renderApp('/');
    const card = await screen.findByRole('article', { name: 'Resultado da manhã de 05/10/2026' });
    expect(card).toHaveTextContent('Abertura às 06:50: executado — 28/30 ligadas');
    expect(card).toHaveTextContent('Lab 1: não acordaram LAB1-PC11, LAB1-PC12');
    expect(within(card).getByRole('link', { name: 'LAB1-PC12' })).toHaveAttribute(
      'href',
      '/dispositivos/12#diagnostico',
    );
    await user.click(within(card).getByRole('button', { name: 'Ciente' }));
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/notices/3/ack')).toBe(true));
  });

  it('AC-007-07: machines moved by enrollment are listed with their old and new room', async () => {
    const data: EnrollmentMoves = {
      moves: [{ deviceId: 7, deviceName: 'PC-07', from: 'Lab 2', to: 'Lab 3', at: at(9, 15) }],
    };
    const api = loggedInApi()
      .on('GET', '/api/dashboard', {
        body: {
          ...DASH,
          notices: [{ id: 4, type: 'enrollment_moves', createdAt: at(9, 15), data }],
        },
      })
      .on('POST', '/api/notices/4/ack', { status: 204 });
    const user = userEvent.setup();
    renderApp('/');
    const card = await screen.findByRole('article', { name: 'Computadores que mudaram de sala' });
    expect(card).toHaveTextContent('PC-07: Lab 2 → Lab 3 (05/10/2026 09:15)');
    expect(within(card).getByRole('link', { name: 'PC-07' })).toHaveAttribute(
      'href',
      '/dispositivos/7',
    );
    await user.click(within(card).getByRole('button', { name: 'Ciente' }));
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/notices/4/ack')).toBe(true));
  });
});

describe('global banners (constitution §8)', () => {
  it('every page shows the same banners, problems first: update failure, pause, simulation', async () => {
    for (const path of ['/salas', '/agendamentos', '/historico']) {
      loggedInApi()
        .on('GET', '/api/dashboard', {
          body: {
            ...DASH,
            dryRun: true,
            pause: { since: at(8), reason: 'Férias', resumeAt: null, by: 'ana' },
            notices: [
              {
                id: 1,
                type: 'update_failed',
                createdAt: at(4),
                data: { message: 'Download interrompido.' },
              },
            ],
          },
        })
        .on('GET', '/api/rooms', { body: [] })
        .on('GET', '/api/tags', { body: [] })
        .on('GET', '/api/schedules', { body: [] })
        .on('GET', '/api/schedule-exceptions', { body: [] })
        .on('GET', '/api/jobs', { body: { items: [], total: 0, page: 1, pageSize: 50 } })
        .on('GET', '/api/schedule-runs', { body: { items: [], total: 0, page: 1, pageSize: 50 } });
      const { unmount, container } = renderApp(path);
      await screen.findByText('Agendamentos pausados:');
      const texts = [...container.querySelectorAll('[role=alert], [role=status]')]
        .map((e) => e.textContent ?? '')
        .filter((t) => /atualização|pausados|simulação/i.test(t));
      expect(
        texts.map((t) =>
          t.includes('atualização') ? 'update' : t.includes('pausados') ? 'pause' : 'dryRun',
        ),
        path,
      ).toEqual(['update', 'pause', 'dryRun']);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('demo mode replaces the simulation banner', async () => {
    loggedInApi()
      .on('GET', '/api/dashboard', { body: { ...DASH, demo: true, dryRun: true } })
      .on('GET', '/api/rooms', { body: [] })
      .on('GET', '/api/tags', { body: [] });
    renderApp('/salas');
    expect(await screen.findByText('Modo demonstração.')).toBeInTheDocument();
    expect(screen.queryByText(/Modo simulação ativo/)).not.toBeInTheDocument();
  });
});
