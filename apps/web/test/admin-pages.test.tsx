import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTING_DEFS, SETTING_KEYS } from '@uniwake/shared';
import { fromInput, toInput } from '../src/features/admin/SettingsPage';
import { ADMIN, installFakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function settingsApi() {
  return loggedInApi()
    .on('GET', '/api/settings', { body: { values: DEFAULT_SETTINGS, pendingRestart: [] } })
    .on('GET', '/api/network/interfaces', {
      body: {
        interfaces: [
          {
            name: 'Ethernet',
            address: '10.0.3.15',
            prefixLength: 24,
            gateway: '10.0.3.1',
            mac: 'x',
            selected: true,
            reason: null,
          },
          {
            name: 'vEthernet',
            address: '172.20.0.1',
            prefixLength: 20,
            gateway: null,
            mac: 'y',
            selected: false,
            reason: 'sem gateway padrão (virtual, VPN ou rede isolada)',
          },
        ],
        ports: [9, 7],
        repeat: 3,
        destinations: [
          { sourceIp: '10.0.3.15', destination: '255.255.255.255' },
          { sourceIp: '10.0.3.15', destination: '10.0.3.255' },
        ],
        rooms: [],
      },
    });
}

describe('settings form (FR-016)', () => {
  it('AC-016-01: every setting in the shared registry has a labelled control', async () => {
    settingsApi();
    renderApp('/configuracoes');
    await screen.findByRole('heading', { level: 1, name: 'Configurações' });
    for (const key of SETTING_KEYS) {
      const label = SETTING_DEFS[key].meta.label;
      expect(screen.getAllByLabelText(new RegExp(`^${escape(label)}`)).length, key).toBeGreaterThan(
        0,
      );
    }
  });

  it('converts values between inputs and settings', () => {
    expect(toInput('wake.ports', [9, 7])).toBe('9, 7');
    expect(fromInput('wake.ports', '9, 7')).toEqual([9, 7]);
    expect(fromInput('wake.interfaces', ' 10.0.3.15 ; 10.0.4.20 ')).toEqual([
      '10.0.3.15',
      '10.0.4.20',
    ]);
    expect(fromInput('monitor.intervalSeconds', '30')).toBe(30);
    expect(toInput('panel.lanEnabled', false)).toBe(false);
  });

  it('saves only what changed in a group, shows server field errors and the restart note', async () => {
    const patches: unknown[] = [];
    settingsApi().on('PATCH', '/api/settings', (body) => {
      patches.push(body);
      const b = body as Record<string, unknown>;
      if (b['monitor.intervalSeconds'] === 5) {
        return {
          status: 422,
          body: {
            code: 'VALIDATION_FAILED',
            message: 'x',
            details: [{ path: 'monitor.intervalSeconds', message: 'Mínimo 10.' }],
          },
        };
      }
      return { body: { changes: [{ key: 'monitor.intervalSeconds' }], restartRequired: [] } };
    });
    const user = userEvent.setup();
    renderApp('/configuracoes');
    const group = await screen.findByRole('form', { name: 'Monitoramento' });
    const field = within(group).getByLabelText(
      new RegExp(`^${escape(SETTING_DEFS['monitor.intervalSeconds'].meta.label)}`),
    );
    await user.clear(field);
    await user.type(field, '5');
    await user.click(within(group).getByRole('button', { name: /Salvar/ }));
    expect(await within(group).findByText('Mínimo 10.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '30');
    await user.click(within(group).getByRole('button', { name: /Salvar/ }));
    expect(
      await within(group).findByText('Salvo. As alterações já estão valendo.'),
    ).toBeInTheDocument();
    expect(patches.at(-1)).toEqual({ 'monitor.intervalSeconds': 30 });
  });

  it('AC-011-01: the network preview lists the interfaces and exactly the destinations', async () => {
    settingsApi();
    renderApp('/configuracoes');
    const list = await screen.findByRole('list', { name: 'Destinos' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '10.0.3.15 → 255.255.255.255 (portas 9, 7, 3×)',
      '10.0.3.15 → 10.0.3.255 (portas 9, 7, 3×)',
    ]);
    expect(
      screen.getByText('Não — sem gateway padrão (virtual, VPN ou rede isolada)'),
    ).toBeInTheDocument();
  });
});

describe('navigation by role (FR-006.2)', () => {
  it('operators do not see Configurações or Usuários; admins do', async () => {
    installFakeApi()
      .on('GET', '/api/auth/setup-status', { body: { needsSetup: false } })
      .on('GET', '/api/auth/me', { body: { id: 2, username: 'op', role: 'operator' } })
      .on('GET', '/api/dashboard', { status: 404 });
    const { unmount } = renderApp('/historico');
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    expect(within(nav).queryByRole('link', { name: 'Configurações' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Usuários' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Auditoria' })).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    settingsApi();
    renderApp('/historico');
    const adminNav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    expect(within(adminNav).getByRole('link', { name: 'Configurações' })).toBeInTheDocument();
    expect(within(adminNav).getByRole('link', { name: 'Usuários' })).toBeInTheDocument();
    expect(ADMIN.role).toBe('admin');
  });
});

describe('users (FR-006.2)', () => {
  it('lists, creates (weak password shown at the field), changes role and resets a password', async () => {
    const calls = loggedInApi()
      .on('GET', '/api/users', {
        body: [
          {
            id: 2,
            username: 'maria',
            role: 'operator',
            enabled: true,
            createdAt: 0,
            passwordChangedAt: 0,
          },
        ],
      })
      .on('POST', '/api/users', (body) =>
        (body as { password: string }).password === '1234567890'
          ? { status: 422, body: { code: 'PASSWORD_TOO_WEAK', message: 'Senha fraca.' } }
          : {
              status: 201,
              body: {
                id: 3,
                username: 'joao',
                role: 'operator',
                enabled: true,
                createdAt: 0,
                passwordChangedAt: 0,
              },
            },
      )
      .on('PATCH', '/api/users/2', {
        body: {
          id: 2,
          username: 'maria',
          role: 'admin',
          enabled: true,
          createdAt: 0,
          passwordChangedAt: 0,
        },
      })
      .on('POST', '/api/users/2/reset-password', { status: 204 });
    const user = userEvent.setup();
    renderApp('/usuarios');
    expect(await screen.findByRole('cell', { name: 'maria' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Novo usuário' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo usuário' });
    await user.type(within(dialog).getByLabelText('Usuário'), 'joao');
    await user.type(within(dialog).getByLabelText('Senha inicial'), '1234567890');
    await user.click(within(dialog).getByRole('button', { name: 'Criar' }));
    expect(await within(dialog).findByText('Senha fraca.')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Senha inicial'));
    await user.type(within(dialog).getByLabelText('Senha inicial'), 'mesa-azul-do-lab');
    await user.click(within(dialog).getByRole('button', { name: 'Criar' }));
    expect(await screen.findByText('Usuário joao criado.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tornar administrador: maria' }));
    await waitFor(() =>
      expect(calls.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ role: 'admin' }),
    );
    await user.click(screen.getByRole('button', { name: 'Redefinir senha de maria' }));
    const reset = await screen.findByRole('dialog', { name: 'Redefinir senha de maria' });
    await user.type(within(reset).getByLabelText('Nova senha'), 'quadro-branco-novo');
    await user.click(within(reset).getByRole('button', { name: 'Redefinir' }));
    expect(await screen.findByText(/Senha de maria redefinida/)).toBeInTheDocument();
  });
});

describe('audit (FR-006.5)', () => {
  it('shows rows, filters by subject and exports with the same filters', async () => {
    const calls = loggedInApi().on('GET', '/api/audit', {
      body: {
        items: [
          {
            id: 1,
            at: new Date(2026, 9, 5, 7, 0).getTime(),
            actorUserId: 1,
            actorLabel: 'ana',
            action: 'wake.start',
            target: 'room:Lab 3',
            result: 'ok',
            sourceIp: '127.0.0.1',
            details: {},
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    });
    const user = userEvent.setup();
    renderApp('/auditoria');
    expect(await screen.findByRole('cell', { name: 'room:Lab 3' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Assunto'), 'Ligações');
    await waitFor(() =>
      expect(calls.calls.filter((c) => c.path === '/api/audit').length).toBeGreaterThan(1),
    );
    expect(screen.getByRole('link', { name: 'Exportar CSV' })).toHaveAttribute(
      'href',
      '/api/audit/export.csv?action=wake.',
    );
  });
});

describe('own password (FR-006.3)', () => {
  it('shows a wrong current password at its field, then confirms the change', async () => {
    loggedInApi()
      .on('GET', '/api/dashboard', { status: 404 })
      .on('GET', '/api/jobs', { body: { items: [], total: 0, page: 1, pageSize: 50 } })
      .on('POST', '/api/auth/password', (body) =>
        (body as { currentPassword: string }).currentPassword === 'errada'
          ? {
              status: 422,
              body: {
                code: 'VALIDATION_FAILED',
                message: 'x',
                details: [{ path: 'currentPassword', message: 'Senha atual incorreta.' }],
              },
            }
          : { status: 204 },
      );
    const user = userEvent.setup();
    renderApp('/historico');
    await user.click(await screen.findByRole('button', { name: 'Trocar senha' }));
    const dialog = await screen.findByRole('dialog', { name: 'Trocar minha senha' });
    await user.type(within(dialog).getByLabelText('Senha atual'), 'errada');
    await user.type(within(dialog).getByLabelText('Nova senha'), 'cadeira-verde-nova');
    await user.click(within(dialog).getByRole('button', { name: 'Trocar senha' }));
    expect(await within(dialog).findByText('Senha atual incorreta.')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Senha atual'));
    await user.type(within(dialog).getByLabelText('Senha atual'), 'a-certa-123');
    await user.click(within(dialog).getByRole('button', { name: 'Trocar senha' }));
    expect(await within(dialog).findByText(/Suas outras sessões/)).toBeInTheDocument();
  });
});

describe('logs (FR-016)', () => {
  it('shows entries newest first, filters by level and offers the download', async () => {
    const calls = loggedInApi().on('GET', '/api/logs', (_b, url) => ({
      body: {
        entries:
          url.searchParams.get('level') === 'error'
            ? [
                {
                  time: '2026-10-05T09:00:03Z',
                  level: 'error',
                  msg: 'monitoring sweep failed',
                  module: 'monitor',
                  data: {},
                },
              ]
            : [
                {
                  time: '2026-10-05T09:00:03Z',
                  level: 'error',
                  msg: 'monitoring sweep failed',
                  module: 'monitor',
                  data: {},
                },
                {
                  time: '2026-10-05T09:00:01Z',
                  level: 'info',
                  msg: 'UniWake hub started',
                  module: null,
                  data: { version: '1.0.0' },
                },
              ],
        truncated: true,
        size: 6_000_000,
      },
    }));
    const user = userEvent.setup();
    renderApp('/logs');
    const list = await screen.findByRole('list', { name: 'Entradas do log' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('{"version":"1.0.0"}');
    expect(screen.getByText('Mostrando só os últimos 5 MB do arquivo atual.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar arquivo' })).toHaveAttribute(
      'href',
      '/api/logs/download',
    );
    await user.selectOptions(screen.getByLabelText('Nível mínimo'), 'Só erros');
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Entradas do log' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
    expect(calls.calls.some((c) => c.path === '/api/logs')).toBe(true);
  });
});
