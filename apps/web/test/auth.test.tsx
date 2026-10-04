import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeNext } from '../src/auth/auth';
import { ADMIN, installFakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('auth guard (FR-006.1)', () => {
  it('sends anonymous users to the login page, keeping the destination', async () => {
    installFakeApi()
      .on('GET', '/api/auth/setup-status', { body: { needsSetup: false } })
      .on('GET', '/api/auth/me', { status: 401, body: { code: 'UNAUTHENTICATED', message: 'x' } });
    const { router } = renderApp('/dispositivos');
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fdispositivos');
  });

  it('sends everyone to first access while no admin exists', async () => {
    installFakeApi().on('GET', '/api/auth/setup-status', { body: { needsSetup: true } });
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Primeiro acesso' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/primeiro-acesso');
  });

  it('shows the API error state when the hub is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível falar com o serviço UniWake',
    );
  });

  it('only accepts relative redirect targets', () => {
    expect(safeNext('/salas/3')).toBe('/salas/3');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('login page', () => {
  it('logs in and goes to the requested page', async () => {
    let loggedIn = false;
    const api = installFakeApi()
      .on('GET', '/api/auth/setup-status', { body: { needsSetup: false } })
      .on('GET', '/api/auth/me', () =>
        loggedIn
          ? { body: ADMIN }
          : { status: 401, body: { code: 'UNAUTHENTICATED', message: 'x' } },
      )
      .on('POST', '/api/auth/login', () => {
        loggedIn = true;
        return { body: ADMIN };
      });
    const user = userEvent.setup();
    const { router } = renderApp('/login?next=%2Fagendamentos');
    await user.type(await screen.findByLabelText('Usuário'), 'admin');
    await user.type(screen.getByLabelText('Senha'), 'senha-forte-123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/agendamentos'));
    expect(api.calls.find((c) => c.path === '/api/auth/login')?.body).toEqual({
      username: 'admin',
      password: 'senha-forte-123',
    });
  });

  it('shows the pt-BR error from the hub and clears the password', async () => {
    installFakeApi()
      .on('GET', '/api/auth/setup-status', { body: { needsSetup: false } })
      .on('GET', '/api/auth/me', { status: 401, body: { code: 'UNAUTHENTICATED', message: 'x' } })
      .on('POST', '/api/auth/login', {
        status: 401,
        body: { code: 'LOGIN_INVALID', message: 'Usuário ou senha incorretos.' },
      });
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Usuário'), 'admin');
    await user.type(screen.getByLabelText('Senha'), 'errada-errada');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuário ou senha incorretos.');
    expect(screen.getByLabelText('Senha')).toHaveValue('');
  });
});

describe('first access page', () => {
  it('validates length and confirmation before submitting', async () => {
    const api = installFakeApi().on('GET', '/api/auth/setup-status', {
      body: { needsSetup: true },
    });
    const user = userEvent.setup();
    renderApp('/primeiro-acesso');
    await user.type(await screen.findByLabelText('Senha'), 'curta');
    expect(screen.getByText('A senha precisa de pelo menos 10 caracteres.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Senha'));
    await user.type(screen.getByLabelText('Senha'), 'senha-forte-123');
    await user.type(screen.getByLabelText('Confirme a senha'), 'senha-diferente');
    expect(screen.getByText('As senhas não conferem.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar administrador' })).toBeDisabled();
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('creates the admin, logs in and opens the dashboard', async () => {
    let created = false;
    const api = installFakeApi()
      .on('GET', '/api/auth/setup-status', () => ({ body: { needsSetup: !created } }))
      .on('POST', '/api/auth/setup', () => {
        created = true;
        return { status: 201, body: ADMIN };
      })
      .on('POST', '/api/auth/login', { body: ADMIN })
      .on('GET', '/api/auth/me', { body: ADMIN });
    const user = userEvent.setup();
    const { router } = renderApp('/primeiro-acesso');
    await user.type(await screen.findByLabelText('Senha'), 'senha-forte-123');
    await user.type(screen.getByLabelText('Confirme a senha'), 'senha-forte-123');
    await user.click(screen.getByRole('button', { name: 'Criar administrador' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /api/auth/setup');
    expect(
      await screen.findByRole('navigation', { name: 'Navegação principal' }),
    ).toBeInTheDocument();
  });

  it('shows the hub error when setup is refused (not on this computer)', async () => {
    installFakeApi()
      .on('GET', '/api/auth/setup-status', { body: { needsSetup: true } })
      .on('POST', '/api/auth/setup', {
        status: 403,
        body: {
          code: 'SETUP_NOT_ALLOWED',
          message:
            'O primeiro acesso só pode ser feito no próprio computador do UniWake (localhost).',
        },
      });
    const user = userEvent.setup();
    renderApp('/primeiro-acesso');
    await user.type(await screen.findByLabelText('Senha'), 'senha-forte-123');
    await user.type(screen.getByLabelText('Confirme a senha'), 'senha-forte-123');
    await user.click(screen.getByRole('button', { name: 'Criar administrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('próprio computador do UniWake');
  });
});

describe('logout', () => {
  it('calls the API and returns to the login page', async () => {
    let loggedIn = true;
    const api = loggedInApi()
      .on('GET', '/api/auth/me', () =>
        loggedIn
          ? { body: ADMIN }
          : { status: 401, body: { code: 'UNAUTHENTICATED', message: 'x' } },
      )
      .on('POST', '/api/auth/logout', () => {
        loggedIn = false;
        return { status: 204 };
      });
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(api.calls.some((c) => c.path === '/api/auth/logout')).toBe(true);
  });
});
