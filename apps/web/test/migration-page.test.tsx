import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportInspect, ImportPreview, MigrationState } from '@uniwake/shared';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

beforeEach(() => {
  // jsdom has no object URLs; the download link is all we need to see.
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const EMPTY: MigrationState = { standby: null, lastImport: null, lastAutoExport: null };

const INSPECT: ImportInspect = {
  importId: 'a1b2c3d4-0000-4000-8000-000000000001',
  format: 1,
  blocked: null,
  manifest: {
    appVersion: '1.4.0',
    createdAt: Date.UTC(2026, 9, 12, 15),
    source: { name: 'PC-TI-ANTIGO', instanceId: 'i-1' },
    sections: ['inventory', 'schedules', 'users'],
    counts: { room: 2 },
    secrets: true,
    checksum: 'a'.repeat(64),
  },
};

const PREVIEW: ImportPreview = {
  mode: 'replace',
  sections: {
    inventory: { created: 10, updated: 2, unchanged: 1, ignored: 0 },
    schedules: { created: 3, updated: 0, unchanged: 0, ignored: 0 },
  },
  conflicts: [
    {
      label: 'room: Lab 2',
      kind: 'duplicate_name',
      resolution: 'renomeado para não repetir o nome',
    },
  ],
  removed: { inventory: 4 },
  hubKey: 'none',
  standby: true,
  notes: ['Depois da importação este UniWake fica "em espera".'],
};

function api(state: MigrationState = EMPTY): FakeApi {
  return loggedInApi().on('GET', '/api/migration/state', { body: state });
}

describe('Backup e migração — export (FR-401)', () => {
  it('exports the default sections with the password typed twice', async () => {
    const fake = api().on('POST', '/api/migration/export', { body: {} });
    const user = userEvent.setup();
    renderApp('/backup');
    const section = await screen.findByRole('region', { name: 'Exportar' });
    expect(within(section).getByLabelText(/Histórico/)).not.toBeChecked();
    expect(within(section).getByLabelText(/Cadastro/)).toBeChecked();
    await user.type(within(section).getByLabelText('Senha do arquivo'), 'senha-de-teste-aaaa');
    await user.type(within(section).getByLabelText('Repita a senha'), 'senha-de-teste-bbbb');
    await user.click(within(section).getByRole('button', { name: 'Exportar' }));
    expect(await within(section).findByText('As duas senhas não são iguais.')).toBeInTheDocument();
    await user.clear(within(section).getByLabelText('Repita a senha'));
    await user.type(within(section).getByLabelText('Repita a senha'), 'senha-de-teste-aaaa');
    await user.click(within(section).getByRole('button', { name: 'Exportar' }));
    expect(await within(section).findByText(/Arquivo UniWake\.uniwake salvo/)).toBeInTheDocument();
    expect(fake.calls.find((c) => c.path === '/api/migration/export')?.body).toEqual({
      sections: ['inventory', 'schedules', 'settings', 'users', 'agents'],
      password: 'senha-de-teste-aaaa',
    });
  });

  it('without secret sections there is no password and the page says what is left out', async () => {
    const fake = api().on('POST', '/api/migration/export', { body: {} });
    const user = userEvent.setup();
    renderApp('/backup');
    const section = await screen.findByRole('region', { name: 'Exportar' });
    await user.click(within(section).getByLabelText(/Usuários/));
    await user.click(within(section).getByLabelText(/Desligamento remoto/));
    expect(within(section).queryByLabelText('Senha do arquivo')).toBeNull();
    expect(section).toHaveTextContent('não precisa de senha');
    await user.click(within(section).getByRole('button', { name: 'Exportar' }));
    await waitFor(() =>
      expect(fake.calls.find((c) => c.path === '/api/migration/export')?.body).toEqual({
        sections: ['inventory', 'schedules', 'settings'],
      }),
    );
  });

  it('shows the hub error when the export fails', async () => {
    api().on('POST', '/api/migration/export', {
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Erro interno inesperado.' },
    });
    const user = userEvent.setup();
    renderApp('/backup');
    const section = await screen.findByRole('region', { name: 'Exportar' });
    await user.click(within(section).getByLabelText(/Usuários/));
    await user.click(within(section).getByLabelText(/Desligamento remoto/));
    await user.click(within(section).getByRole('button', { name: 'Exportar' }));
    expect(await within(section).findByText('Erro interno inesperado.')).toBeInTheDocument();
  });
});

describe('Backup e migração — import (FR-403)', () => {
  it('AC-403-01: file → manifest → password → preview → IMPORTAR → done', async () => {
    const fake = api()
      .on('POST', '/api/migration/import', { status: 201, body: INSPECT })
      .on('POST', `/api/migration/import/${INSPECT.importId}/preview`, { body: PREVIEW })
      .on('POST', `/api/migration/import/${INSPECT.importId}/apply`, { body: PREVIEW });
    const user = userEvent.setup();
    renderApp('/backup');
    const section = await screen.findByRole('region', { name: 'Importar' });
    await user.upload(
      within(section).getByLabelText('Arquivo .uniwake'),
      new File(['x'], 'UniWake-PC-2026-10-12.uniwake'),
    );
    expect(await within(section).findByText('PC-TI-ANTIGO')).toBeInTheDocument();
    expect(section).toHaveTextContent('Cadastro, Agendamentos, Usuários');
    await user.type(within(section).getByLabelText('Senha do arquivo'), 'senha-de-teste-aaaa');
    await user.click(within(section).getByLabelText(/Substituir/));
    await user.click(within(section).getByRole('button', { name: 'Ver prévia' }));
    const table = await within(section).findByRole('table', { name: 'Prévia da importação' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Cadastro1021');
    expect(table).toHaveTextContent('Removidos deste PC');
    expect(section).toHaveTextContent('room: Lab 2: renomeado para não repetir o nome');
    const importButton = within(section).getByRole('button', { name: 'Importar' });
    expect(importButton).toBeDisabled();
    await user.type(within(section).getByLabelText('Digite IMPORTAR para confirmar'), 'IMPORTAR');
    await user.click(importButton);
    expect(await within(section).findByText('Importação concluída.')).toBeInTheDocument();
    expect(fake.calls.find((c) => c.path.endsWith('/apply'))?.body).toEqual({
      mode: 'replace',
      password: 'senha-de-teste-aaaa',
      confirm: 'IMPORTAR',
    });
  });

  it('a PC in a team sees why it cannot import; a bad file shows the hub message', async () => {
    api().on('POST', '/api/migration/import', {
      status: 201,
      body: { ...INSPECT, blocked: 'Este PC está numa equipe: importe num PC fora da equipe.' },
    });
    const user = userEvent.setup();
    const { unmount } = renderApp('/backup');
    const section = await screen.findByRole('region', { name: 'Importar' });
    await user.upload(
      within(section).getByLabelText('Arquivo .uniwake'),
      new File(['x'], 'a.uniwake'),
    );
    expect(await within(section).findByRole('alert')).toHaveTextContent('está numa equipe');
    expect(within(section).queryByRole('button', { name: 'Ver prévia' })).toBeNull();
    unmount();
    vi.unstubAllGlobals();
    api().on('POST', '/api/migration/import', {
      status: 422,
      body: {
        code: 'IMPORT_NOT_UNIWAKE',
        message: 'Este arquivo não é um backup do UniWake (.uniwake).',
      },
    });
    renderApp('/backup');
    const again = await screen.findByRole('region', { name: 'Importar' });
    await user.upload(
      within(again).getByLabelText('Arquivo .uniwake'),
      new File(['x'], 'b.uniwake'),
    );
    expect(await within(again).findByText(/não é um backup do UniWake/)).toBeInTheDocument();
  });
});

describe('standby and undo (FR-403.4, FR-404)', () => {
  it('AC-404-01: the banner and "Ativar este UniWake" with typed confirmation', async () => {
    const fake = api({
      ...EMPTY,
      standby: { since: Date.UTC(2026, 9, 12, 15), from: 'PC-TI-ANTIGO', by: 'admin' },
    }).on('POST', '/api/migration/standby/activate', { status: 204 });
    const user = userEvent.setup();
    renderApp('/backup');
    const card = await screen.findByRole('region', { name: 'Situação' });
    expect(card).toHaveTextContent('Em espera');
    await user.click(within(card).getByRole('button', { name: 'Ativar este UniWake' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ativar este UniWake?' });
    const ok = within(dialog).getByRole('button', { name: 'Ativar' });
    expect(ok).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Digite ATIVAR para confirmar'), 'ATIVAR');
    await user.click(ok);
    await waitFor(() =>
      expect(fake.calls.some((c) => c.path === '/api/migration/standby/activate')).toBe(true),
    );
  });

  it('every page shows the standby banner from the dashboard', async () => {
    loggedInApi().on('GET', '/api/dashboard', {
      body: {
        counters: { online: 0, offline: 0, desconhecido: 0, total: 0 },
        rooms: [],
        noRoom: null,
        tags: [],
        notices: [],
        demo: false,
        dryRun: false,
        lastSweepAt: null,
        pause: null,
        standby: { since: 1, from: 'PC-TI-ANTIGO' },
      },
    });
    renderApp('/');
    expect(await screen.findByText(/Este UniWake está em espera/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Revise e ative/ })).toHaveAttribute('href', '/backup');
  });

  it('shows loading and error states of the situation', async () => {
    loggedInApi().on('GET', '/api/migration/state', {
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Erro interno inesperado.' },
    });
    renderApp('/backup');
    expect(await screen.findByText('Erro interno inesperado.')).toBeInTheDocument();
  });
});
