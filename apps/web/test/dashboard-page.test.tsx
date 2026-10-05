import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dashboard, RoomLastAction } from '@uniwake/shared';
import { lastActionText } from '../src/features/dashboard/DashboardPage';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const NOW = Date.UTC(2026, 9, 5, 12, 0);
const counts = (online: number, offline: number, desconhecido = 0) => ({
  online,
  offline,
  desconhecido,
  total: online + offline + desconhecido,
});

function dashboard(over: Partial<Dashboard> = {}): Dashboard {
  return {
    counters: counts(30, 25, 5),
    rooms: [
      {
        id: 1,
        name: 'Laboratório 1',
        code: 'LAB1',
        block: 'Bloco A',
        floor: '1º andar',
        color: '#2563eb',
        counts: counts(28, 2),
        lastAction: {
          jobId: 5,
          source: 'schedule',
          state: 'concluido',
          dryRun: false,
          at: new Date(2026, 9, 5, 6, 50).getTime(),
          total: 30,
          woke: 28,
          alreadyOn: 0,
          noResponse: 2,
          sendFailed: 0,
        },
      },
      {
        id: 2,
        name: 'Laboratório 2',
        code: 'LAB2',
        block: 'Bloco A',
        floor: null,
        color: '#16a34a',
        counts: counts(0, 20),
        lastAction: null,
      },
      {
        id: 3,
        name: 'Biblioteca',
        code: 'BIB',
        block: null,
        floor: null,
        color: '#9333ea',
        counts: counts(2, 3, 5),
        lastAction: null,
      },
    ],
    noRoom: null,
    tags: [{ id: 7, name: 'Projetor', color: '#0891b2', total: 3 }],
    notices: [],
    demo: false,
    lastSweepAt: NOW,
    pause: null,
    ...over,
  };
}

const PREVIEW = {
  count: 2,
  rooms: [{ roomId: 1, name: 'Laboratório 1', count: 2 }],
  excluded: [],
  needsConfirmation: false,
};

function dashApi(d: Dashboard = dashboard()): FakeApi {
  return loggedInApi()
    .on('GET', '/api/dashboard', { body: d })
    .on('GET', '/api/rooms', { body: [] })
    .on('POST', '/api/wake/preview', { body: PREVIEW });
}

describe('dashboard (FR-004.5)', () => {
  it('AC-004-09: shows counters, room cards in server order with online/total and last action', async () => {
    dashApi(dashboard({ noRoom: counts(1, 1) }));
    renderApp('/');
    const cards = await screen.findByRole('list', { name: 'Salas' });
    const headings = within(cards)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Laboratório 1', 'Laboratório 2', 'Biblioteca', 'Sem sala']);
    const lab1 = within(cards).getAllByRole('listitem')[0]!;
    expect(within(lab1).getByText('28/30')).toBeInTheDocument();
    expect(within(lab1).getByText('Bloco A · 1º andar')).toBeInTheDocument();
    expect(within(lab1).getByText(/por agendamento — 28\/30 acordaram/)).toBeInTheDocument();
    const counters = screen.getByLabelText('Contadores');
    expect(within(counters).getByRole('button', { name: /30\s*Ligadas/ })).toBeInTheDocument();
    expect(within(counters).getByText('60')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Painel' })).toBeInTheDocument();
  });

  it('room card buttons open the wake preview for that room; "Sem sala" uses includeNoRoom', async () => {
    const api = dashApi(dashboard({ noRoom: counts(0, 2) }));
    const user = userEvent.setup();
    renderApp('/');
    await user.click(
      await screen.findByRole('button', { name: 'Ligar só os desligados — Laboratório 2' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Ligar só os desligados — Laboratório 2' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.calls.find((c) => c.path === '/api/wake/preview')?.body).toEqual({
        target: { type: 'rooms', roomIds: [2], includeNoRoom: false },
        onlyOffline: true,
      }),
    );
    await user.keyboard('{Escape}');
    const noRoom = screen
      .getAllByRole('listitem')
      .find((li) => within(li).queryByText('Sem sala'))!;
    await user.click(within(noRoom).getByRole('button', { name: 'Ligar sala' }));
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === '/api/wake/preview').at(-1)?.body).toMatchObject({
        target: { type: 'rooms', roomIds: [], includeNoRoom: true },
      }),
    );
    expect(screen.getByRole('link', { name: 'Ver máquinas — Laboratório 1' })).toHaveAttribute(
      'href',
      '/salas/1',
    );
  });

  it('AC-004-15: "/" focuses the search and results list only matching devices', async () => {
    const api = dashApi().on('GET', '/api/devices', (_b, url) => ({
      body: {
        items:
          url.searchParams.get('q') === '10.0.3.2'
            ? [
                {
                  id: 11,
                  name: 'LAB1-PC02',
                  status: 'online',
                  ip: '10.0.3.2',
                  roomId: null,
                  tagIds: [],
                },
              ]
            : [],
        total: url.searchParams.get('q') === '10.0.3.2' ? 1 : 0,
        page: 1,
        pageSize: 50,
      },
    }));
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('list', { name: 'Salas' });
    await user.keyboard('/');
    const search = screen.getByRole('searchbox', { name: 'Buscar máquina' });
    expect(search).toHaveFocus();
    await user.keyboard('10.0.3.2');
    const results = await screen.findByRole('region', { name: 'Resultados da busca' });
    expect(await within(results).findByRole('link', { name: 'LAB1-PC02' })).toHaveAttribute(
      'href',
      '/dispositivos/11',
    );
    expect(within(results).getByText('1 máquina encontrada.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Salas' })).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/api/devices')).toBe(true);
  });

  it('"/" typed inside a field is just text', async () => {
    dashApi().on('GET', '/api/devices', { body: { items: [], total: 0, page: 1, pageSize: 50 } });
    const user = userEvent.setup();
    renderApp('/');
    const search = await screen.findByRole('searchbox', { name: 'Buscar máquina' });
    await user.click(search);
    await user.keyboard('a/b');
    expect(search).toHaveValue('a/b');
  });

  it('a tag filter offers "Ligar dispositivos com esta tag"; counters toggle the status filter', async () => {
    const api = dashApi().on('GET', '/api/devices', {
      body: { items: [], total: 0, page: 1, pageSize: 50 },
    });
    const user = userEvent.setup();
    renderApp('/');
    await user.selectOptions(await screen.findByLabelText('Etiqueta'), 'Projetor (3)');
    await user.click(screen.getByRole('button', { name: 'Ligar dispositivos com esta tag' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.path === '/api/wake/preview')?.body).toMatchObject({
        target: { type: 'tags', tagIds: [7] },
      }),
    );
    await user.keyboard('{Escape}');

    const offline = screen.getByRole('button', { name: /25\s*Desligadas/ });
    await user.click(offline);
    expect(offline).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Nenhuma máquina encontrada.')).toBeInTheDocument();
    await waitFor(() => {
      const last = api.calls.filter((c) => c.path === '/api/devices').at(-1);
      expect(last).toBeDefined();
    });
  });

  it('shows an empty state with next steps when nothing is registered', async () => {
    dashApi(dashboard({ rooms: [], noRoom: null, counters: counts(0, 0) }));
    renderApp('/');
    expect(await screen.findByText('Nenhuma máquina cadastrada ainda')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'importe uma planilha CSV' })).toHaveAttribute(
      'href',
      '/dispositivos/importar',
    );
  });

  it('FR-015: the demo banner appears on every page in demo mode', async () => {
    dashApi(dashboard({ demo: true })).on('GET', '/api/tags', { body: [] });
    renderApp('/salas');
    expect(await screen.findByText('Modo demonstração.')).toBeInTheDocument();
  });
});

describe('lastActionText', () => {
  const base: RoomLastAction = {
    jobId: 1,
    source: 'manual',
    state: 'concluido',
    dryRun: false,
    at: new Date(2026, 9, 5, 6, 50).getTime(),
    total: 30,
    woke: 25,
    alreadyOn: 3,
    noResponse: 1,
    sendFailed: 1,
  };
  const sameDay = new Date(2026, 9, 5, 15, 0).getTime();

  it('describes the latest wake in pt-BR', () => {
    expect(lastActionText(base, sameDay)).toBe(
      'Ligada às 06:50 manualmente — 25/30 acordaram, 3 já estavam ligadas, 1 falha no envio',
    );
    expect(
      lastActionText(
        { ...base, source: 'schedule', alreadyOn: 0, sendFailed: 0, dryRun: true },
        sameDay,
      ),
    ).toBe('Ligada às 06:50 por agendamento — 25/30 acordaram (simulação)');
    expect(
      lastActionText({ ...base, state: 'verificando', alreadyOn: 0, sendFailed: 0 }, sameDay),
    ).toMatch(/^Ligando às 06:50 manualmente/);
    expect(lastActionText({ ...base, alreadyOn: 0, sendFailed: 0 }, sameDay + 86_400_000)).toMatch(
      /^Ligada em 05\/10\/2026 06:50 manualmente/,
    );
  });
});

describe('system notices', () => {
  it('explains a LAN access failure', async () => {
    dashApi(
      dashboard({
        notices: [
          {
            id: 9,
            type: 'lan_error',
            createdAt: NOW,
            data: { message: 'Certificado inválido ou senha incorreta.' },
          },
        ],
      }),
    );
    renderApp('/');
    expect(
      await screen.findByText(
        /O acesso ao painel pela rede está ligado, mas não iniciou: Certificado inválido/,
      ),
    ).toBeInTheDocument();
  });
});
