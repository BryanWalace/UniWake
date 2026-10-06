import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@uniwake/shared';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m).getTime();
const HEALTH = {
  status: 'ok',
  version: '1.0.0',
  startedAt: 0,
  uptimeMs: 3_600_000,
  dbSizeBytes: null,
  lastBackupAt: null,
  scheduler: { lastTickAt: at(9), stalled: false, paused: false, nextRun: null },
  monitor: { lastSweepAt: null, durationMs: null, stalled: false },
  clock: { skewMs: null, checkedAt: null },
  host: { sleepOnAc: null, pendingReboot: null, activeHours: null, checkedAt: null },
  warnings: [],
};
const STATUS: UpdateStatus = {
  current: '1.0.0',
  enabled: true,
  mode: 'auto',
  latest: { version: '1.1.0', name: 'UniWake 1.1.0', notes: '- Página de ajuda', publishedAt: '' },
  available: true,
  checking: false,
  lastCheckAt: at(9),
  lastSuccessAt: at(9),
  nextCheckAt: at(15),
  error: null,
  canInstall: true,
  installing: null,
  blocked: false,
};

function api(status: Partial<UpdateStatus> = {}, role: 'admin' | 'operator' = 'admin'): FakeApi {
  return loggedInApi()
    .on('GET', '/api/auth/me', { body: { id: 1, username: 'ana', role } })
    .on('GET', '/api/health/details', { body: HEALTH })
    .on('GET', '/api/update', { body: { ...STATUS, ...status } })
    .on('POST', '/api/update/install', { status: 202, body: { version: '1.1.0' } });
}

const card = async () => screen.findByRole('region', { name: 'Atualizações' });

describe('update panel (FR-001.2, FR-001.3)', () => {
  it('AC-001-04: shows "Nova versão 1.1.0 disponível" and the release notes', async () => {
    api();
    renderApp('/saude');
    const c = await card();
    expect(c).toHaveTextContent('Versão em uso: 1.0.0. Nova versão 1.1.0 disponível.');
    expect(within(c).getByText('Novidades da versão 1.1.0')).toBeInTheDocument();
    expect(c).toHaveTextContent('- Página de ajuda');
  });

  it('AC-001-06: a failed check says so with the last successful check', async () => {
    api({ error: 'Não foi possível verificar atualizações.', available: false });
    renderApp('/saude');
    expect(await within(await card()).findByRole('alert')).toHaveTextContent(
      'Não foi possível verificar atualizações. Última verificação bem-sucedida: 05/10/2026 09:00.',
    );
  });

  it('AC-001-10: operators see the status but no "Atualizar agora" or "Verificar agora"', async () => {
    api({}, 'operator');
    renderApp('/saude');
    const c = await card();
    expect(c).toHaveTextContent('Nova versão 1.1.0 disponível');
    expect(within(c).queryByRole('button')).not.toBeInTheDocument();
  });

  it('admins install at once when nothing is busy', async () => {
    const fake = api();
    const user = userEvent.setup();
    renderApp('/saude');
    await user.click(await within(await card()).findByRole('button', { name: 'Atualizar agora' }));
    await waitFor(() =>
      expect(fake.calls.find((x) => x.path === '/api/update/install')?.body).toEqual({
        override: false,
      }),
    );
  });

  it('AC-001-11 in the UI: near a schedule the admin must confirm an override', async () => {
    const fake = api({ blocked: true });
    const user = userEvent.setup();
    renderApp('/saude');
    await user.click(await within(await card()).findByRole('button', { name: 'Atualizar agora' }));
    const dialog = await screen.findByRole('dialog', { name: 'Atualizar mesmo assim?' });
    expect(fake.calls.some((x) => x.path === '/api/update/install')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Atualizar agora' }));
    await waitFor(() =>
      expect(fake.calls.find((x) => x.path === '/api/update/install')?.body).toEqual({
        override: true,
      }),
    );
  });

  it('demo hubs say they do not look for updates', async () => {
    api({ enabled: false, available: false, latest: null });
    renderApp('/saude');
    expect(await card()).toHaveTextContent('Este UniWake não procura atualizações');
  });
});
