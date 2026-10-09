import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamStatus } from '@uniwake/shared';
import { issueUrl } from '../src/routes/HelpMenu';
import { loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const SELF = 'aaaaaaaa-0000-4000-8000-000000000000';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000000';

const alone = (over: Partial<TeamStatus> = {}): TeamStatus => ({
  inTeam: false,
  self: { instanceId: SELF, name: 'TI-MANHA' },
  epoch: null,
  members: [],
  pairing: { open: false, code: null, expiresAt: null, attemptsLeft: 0 },
  addresses: ['10.0.3.15'],
  port: 47102,
  ...over,
});

const inTeam = (): TeamStatus =>
  alone({
    inTeam: true,
    epoch: 1,
    members: [
      {
        instanceId: SELF,
        name: 'TI-MANHA',
        self: true,
        revoked: false,
        online: true,
        address: null,
        manualAddress: null,
        lastSeenAt: null,
        lastSyncAt: null,
        lastError: null,
        pending: 0,
      },
      {
        instanceId: OTHER,
        name: 'TI-TARDE',
        self: false,
        revoked: false,
        online: false,
        address: '10.0.3.20',
        manualAddress: null,
        lastSeenAt: 1,
        lastSyncAt: Date.UTC(2026, 9, 5, 12),
        lastError:
          'Sem conexão: o PC está desligado, o UniWake não está rodando ou a porta 47102 está bloqueada no firewall.',
        pending: 3,
      },
    ],
  });

describe('Modo equipe page (FR-201, FR-202.6)', () => {
  it('loading, error and the two ways in when this PC is alone', async () => {
    const api = loggedInApi().on('GET', '/api/team', {
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Falhou.' },
    });
    renderApp('/equipe');
    expect(await screen.findByText('Falhou.')).toBeInTheDocument();
    api.on('GET', '/api/team', { body: alone() }).on('GET', '/api/team/discovered', { body: [] });
    await userEvent.click(screen.getByRole('button', { name: /tentar/i }));
    expect(await screen.findByRole('heading', { name: 'Parear com outro PC' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entrar em uma equipe' })).toBeInTheDocument();
    expect(await screen.findByText(/Nenhum encontrado ainda/)).toBeInTheDocument(); // empty discovery
  });

  it('AC-201-01: generating a code shows it with the countdown, attempts and this PC’s address', async () => {
    let status = alone();
    loggedInApi()
      .on('GET', '/api/team', () => ({ body: status }))
      .on('GET', '/api/team/discovered', { body: [] })
      .on('POST', '/api/team/pairing', () => {
        status = alone({
          inTeam: true,
          pairing: { open: true, code: '482913', expiresAt: Date.now() + 300_000, attemptsLeft: 5 },
        });
        return { body: status };
      });
    renderApp('/equipe');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Gerar código de pareamento' }),
    );
    expect(await screen.findByLabelText('Código de pareamento')).toHaveTextContent('482913');
    expect(screen.getByText(/5 tentativas/)).toHaveTextContent('10.0.3.15');
    expect(screen.getByText(/4:5\d|5:00/)).toBeInTheDocument();
  });

  it('AC-201-06: joining a PC with data asks for SUBSTITUIR, then sends it', async () => {
    const api = loggedInApi()
      .on('GET', '/api/team', { body: alone() })
      .on('GET', '/api/team/discovered', {
        body: [
          { instanceId: OTHER, name: 'TI-TARDE', address: '10.0.3.20', port: 47102, seenAt: 1 },
        ],
      })
      .on('POST', '/api/team/join', (body) =>
        (body as { confirm?: string }).confirm === 'SUBSTITUIR'
          ? { body: inTeam() }
          : {
              status: 422,
              body: {
                code: 'TEAM_REPLACE_CONFIRM',
                message: 'Digite SUBSTITUIR.',
                details: { rooms: 2, devices: 30, tags: 1, schedules: 1, users: 1 },
              },
            },
      );
    renderApp('/equipe');
    await userEvent.click(await screen.findByRole('button', { name: 'TI-TARDE (10.0.3.20)' }));
    expect(screen.getByLabelText('Endereço do outro PC')).toHaveValue('10.0.3.20');
    await userEvent.type(screen.getByLabelText('Código de 6 dígitos'), '482913');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar na equipe' }));
    expect(await screen.findByText(/2 salas, 30 máquinas/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Digite SUBSTITUIR para confirmar'), 'SUBSTITUIR');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar na equipe' }));
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === '/api/team/join').at(-1)?.body).toEqual({
        address: '10.0.3.20',
        code: '482913',
        confirm: 'SUBSTITUIR',
      }),
    );
  });

  it('AC-202-07: members show status, last error and pending; "Sincronizar agora" and revocation', async () => {
    const api = loggedInApi()
      .on('GET', '/api/team', { body: inTeam() })
      .on('POST', '/api/team/sync', { body: inTeam() })
      .on('POST', `/api/team/members/${OTHER}/revoke`, { body: inTeam() });
    renderApp('/equipe');
    const row = (await screen.findByText('TI-TARDE')).closest('tr')!;
    expect(within(row).getByText('Offline')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText(/porta 47102 está bloqueada/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sincronizar agora' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/team/sync')).toBe(true),
    );
    await userEvent.click(within(row).getByRole('button', { name: 'Remover da equipe' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remover PC da equipe' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === `/api/team/members/${OTHER}/revoke`)).toBe(true),
    );
  });

  it('a member gets a fixed address for another subnet', async () => {
    const api = loggedInApi()
      .on('GET', '/api/team', { body: inTeam() })
      .on('PATCH', `/api/team/members/${OTHER}`, { body: inTeam() });
    renderApp('/equipe');
    const row = (await screen.findByText('TI-TARDE')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    await userEvent.type(
      screen.getByLabelText('Endereço fixo (opcional)'),
      'TI-TARDE.escola.local',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        address: 'TI-TARDE.escola.local',
      }),
    );
  });
});

describe('Conflitos resolvidos (FR-203)', () => {
  it('empty, error and a listed conflict', async () => {
    const api = loggedInApi().on('GET', '/api/team/conflicts', { body: [] });
    renderApp('/equipe/conflitos');
    expect(await screen.findByText('Nenhum conflito até agora.')).toBeInTheDocument();
    api.on('GET', '/api/team/conflicts', {
      body: [
        {
          id: 1,
          at: Date.UTC(2026, 9, 5, 12),
          entity: 'room',
          entityId: 'x',
          label: 'room: Lab Verde',
          kind: 'concurrent',
          kept: { name: 'Lab Verde' },
          discarded: { name: 'Lab Azul' },
          winnerInstance: OTHER,
        },
      ],
    });
    renderApp('/equipe/conflitos');
    expect(await screen.findByText('Editado nos dois PCs')).toBeInTheDocument();
    expect(screen.getByText('name: Lab Azul')).toBeInTheDocument();
  });
});

describe('Ajuda menu (FR-206, FR-207)', () => {
  it('AC-207-01: issue links open the right GitHub forms with the version pre-filled', async () => {
    expect(issueUrl('bug_report.yml', '1.2.0')).toBe(
      'https://github.com/BryanWalace/UniWake/issues/new?template=bug_report.yml&version=1.2.0',
    );
    loggedInApi()
      .on('GET', '/api/dashboard', { status: 500, body: { code: 'INTERNAL_ERROR', message: 'x' } })
      .on('GET', '/api/update', { body: { current: '1.2.0' } });
    renderApp('/ajuda');
    await userEvent.click(await screen.findByRole('button', { name: /Ajuda/ }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Relatar problema' })).toHaveAttribute(
        'href',
        'https://github.com/BryanWalace/UniWake/issues/new?template=bug_report.yml&version=1.2.0',
      ),
    );
    const feature = screen.getByRole('link', { name: 'Sugerir função' });
    expect(feature).toHaveAttribute(
      'href',
      expect.stringContaining('template=feature_request.yml&version=1.2.0'),
    );
    expect(feature).toHaveAttribute('target', '_blank');
  });

  it('AC-206-01: "Modo equipe" opens the team help page with the Power On by RTC tip', async () => {
    loggedInApi().on('GET', '/api/update', { body: { current: '1.2.0' } });
    renderApp('/ajuda');
    await userEvent.click(await screen.findByRole('button', { name: /Ajuda/ }));
    const links = screen.getAllByRole('link', { name: 'Modo equipe' });
    await userEvent.click(links.find((l) => l.getAttribute('href') === '/ajuda/team-mode')!);
    expect(
      await screen.findByRole('heading', { level: 1, name: /Modo equipe/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Power On by RTC/)).toBeInTheDocument();
    expect(screen.getAllByText(/porta 47102/).length).toBeGreaterThan(0);
  });
});

describe('missed run (FR-204.2)', () => {
  it('AC-204-04: the dashboard offers "Ligar agora" for a run missed while this PC was off', async () => {
    const api = loggedInApi()
      .on('GET', '/api/dashboard', {
        body: {
          counters: { online: 0, offline: 0, desconhecido: 0, total: 0 },
          rooms: [],
          noRoom: null,
          tags: [],
          notices: [
            {
              id: 7,
              type: 'missed_run',
              createdAt: 1,
              data: {
                scheduleId: 1,
                scheduleName: 'Manhã',
                plannedAt: Date.UTC(2026, 9, 5, 9, 50),
              },
            },
          ],
          demo: false,
          dryRun: false,
          lastSweepAt: null,
          pause: null,
        },
      })
      .on('POST', '/api/notices/7/wake-missed', { body: { jobId: 3 } });
    renderApp('/');
    const card = await screen.findByRole('article', { name: 'Agendamento não executado' });
    expect(card).toHaveTextContent('Manhã');
    await userEvent.click(within(card).getByRole('button', { name: 'Ligar agora' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === '/api/notices/7/wake-missed')).toBe(true),
    );
  });
});
