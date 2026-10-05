import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Schedule } from '@uniwake/shared';
import { weekdaysLabel } from '../src/features/schedules/format';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const SCHEDULE: Schedule = {
  id: 1,
  name: 'Abertura manhã',
  enabled: true,
  weekdays: 31,
  timeLocal: '06:50',
  timezone: 'America/Sao_Paulo',
  target: { type: 'rooms', roomIds: [3], includeNoRoom: false },
  targetLabel: 'sala Lab 3',
  onlyOffline: false,
  stagger: null,
  confirmedCount: null,
  targetCount: 30,
  emptyTarget: false,
  needsReconfirm: false,
  nextRun: new Date(2026, 9, 6, 6, 50).getTime(), // local time: tests run in any zone
  createdAt: 0,
  updatedAt: 0,
};

function api(list: Schedule[] = [SCHEDULE]): FakeApi {
  return loggedInApi()
    .on('GET', '/api/schedules', { body: list })
    .on('GET', '/api/rooms', {
      body: [
        {
          id: 3,
          name: 'Lab 3',
          code: 'LAB3',
          block: null,
          floor: null,
          color: '#000',
          deviceCount: 30,
        },
      ],
    })
    .on('GET', '/api/tags', { body: [] });
}

describe('weekdaysLabel', () => {
  it('names the usual sets and lists the rest', () => {
    expect(weekdaysLabel(31)).toBe('Seg a Sex');
    expect(weekdaysLabel(127)).toBe('Todos os dias');
    expect(weekdaysLabel(96)).toBe('Sáb e Dom');
    expect(weekdaysLabel(1 | 4 | 16)).toBe('Seg, Qua, Sex');
  });
});

describe('schedules page (FR-005.1, FR-005.8)', () => {
  it('lists schedules with days, time, target, count and next run; shows "alvo vazio"', async () => {
    api([
      SCHEDULE,
      {
        ...SCHEDULE,
        id: 2,
        name: 'Sala demolida',
        targetCount: 0,
        emptyTarget: true,
        targetLabel: 'salas',
      },
    ]);
    renderApp('/agendamentos');
    const list = await screen.findByRole('list', { name: 'Agendamentos' });
    const [first, second] = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === list);
    expect(first).toHaveTextContent('Seg a Sex às 06:50 · sala Lab 3');
    expect(first).toHaveTextContent('30 máquina(s) · próxima: 06/10/2026 06:50');
    expect(within(second!).getByText(/Alvo vazio/)).toBeInTheDocument();
  });

  it('creates a schedule for a room and confirms a large target once (SR-10)', async () => {
    const posts: unknown[] = [];
    api([]).on('POST', '/api/schedules', (body) => {
      posts.push(body);
      return (body as { confirm?: unknown }).confirm
        ? { status: 201, body: { ...SCHEDULE, name: 'Manhã' } }
        : {
            status: 409,
            body: {
              code: 'CONFIRMATION_REQUIRED',
              message: 'Confirme',
              details: { count: 30, rooms: [] },
            },
          };
    });
    const user = userEvent.setup();
    renderApp('/agendamentos');
    await user.click(await screen.findByRole('button', { name: 'Novo agendamento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo agendamento' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Manhã');
    await user.click(await within(dialog).findByRole('checkbox', { name: /Lab 3/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('Este agendamento liga 30 máquinas a cada execução.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar: 30 máquinas' }));
    expect(await screen.findByText('Agendamento "Manhã" salvo.')).toBeInTheDocument();
    expect(posts[0]).toEqual({
      name: 'Manhã',
      enabled: true,
      weekdays: 31,
      timeLocal: '06:50',
      target: { type: 'rooms', roomIds: [3], includeNoRoom: false },
      onlyOffline: false,
      stagger: null,
    });
    expect(posts[1]).toMatchObject({ confirm: { count: 30 } });
  });

  it('shows field errors from the server next to the fields', async () => {
    api([]).on('POST', '/api/schedules', {
      status: 422,
      body: {
        code: 'VALIDATION_FAILED',
        message: 'Dados inválidos.',
        details: [{ path: 'weekdays', message: 'Escolha pelo menos um dia da semana.' }],
      },
    });
    const user = userEvent.setup();
    renderApp('/agendamentos');
    await user.click(await screen.findByRole('button', { name: 'Novo agendamento' }));
    const dialog = await screen.findByRole('dialog');
    for (const day of ['Seg', 'Ter', 'Qua', 'Qui', 'Sex']) {
      await user.click(within(dialog).getByRole('checkbox', { name: day }));
    }
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('Escolha pelo menos um dia da semana.'),
    ).toBeInTheDocument();
  });

  it('shows the next 5 runs, toggles and deletes', async () => {
    const calls = api()
      .on('GET', '/api/schedules/1/next-runs', {
        body: [0, 1, 2, 3, 4].map((i) => ({
          day: `2026-10-0${6 + i}`,
          at: new Date(2026, 9, 6 + i, 6, 50).getTime(),
        })),
      })
      .on('PATCH', '/api/schedules/1', { body: { ...SCHEDULE, enabled: false } })
      .on('DELETE', '/api/schedules/1', { status: 204 });
    const user = userEvent.setup();
    renderApp('/agendamentos');
    await user.click(await screen.findByText('Próximas 5 execuções'));
    expect(await screen.findByText('10/10/2026 06:50')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desativar Abertura manhã' }));
    await waitFor(() =>
      expect(calls.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: false }),
    );
    await user.click(screen.getByRole('button', { name: 'Excluir Abertura manhã' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Excluir' }),
    );
    await waitFor(() => expect(calls.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('R-M5-01: a target that outgrew its confirmation', () => {
  it('asks for a review in the list', async () => {
    api([{ ...SCHEDULE, needsReconfirm: true, targetCount: 120, confirmedCount: 45 }]);
    renderApp('/agendamentos');
    expect(
      await screen.findByText(/O alvo cresceu: agora liga 120 máquinas \(confirmado para 45\)/),
    ).toBeInTheDocument();
  });
});
