import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fold, matches } from '../src/features/wake/QuickWake';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const room = (id: number, name: string, code: string) => ({
  id,
  name,
  code,
  block: null,
  floor: null,
  color: '#2563eb',
  deviceCount: 10 + id,
});

function api(): FakeApi {
  return loggedInApi()
    .on('GET', '/api/rooms', {
      body: [
        room(1, 'Laboratório 1', 'LAB1'),
        room(3, 'Laboratório 3', 'LAB3'),
        room(4, 'Biblioteca', 'BIB'),
      ],
    })
    .on('GET', '/api/tags', { body: [{ id: 7, name: 'Projetor', color: '#000', deviceCount: 4 }] })
    .on('GET', '/api/devices', (_b, url) => ({
      body: {
        items:
          url.searchParams.get('q') === 'proj'
            ? [
                {
                  id: 9,
                  name: 'PROJ-PC',
                  ip: '10.0.3.9',
                  mac: '00:AA:00:00:00:09',
                  status: 'offline',
                },
              ]
            : [],
        total: 0,
        page: 1,
        pageSize: 8,
      },
    }))
    .on('POST', '/api/wake/preview', {
      body: {
        count: 13,
        rooms: [{ roomId: 3, name: 'Laboratório 3', count: 13 }],
        excluded: [],
        needsConfirmation: false,
      },
    });
}

describe('text matching', () => {
  it('ignores accents and case and matches word prefixes', () => {
    expect(fold('Laboratório Ç')).toBe('laboratorio c');
    expect(matches('Laboratório 3 LAB3', 'lab 3')).toBe(true);
    expect(matches('Laboratório 13 LAB13', 'lab 3')).toBe(false);
    expect(matches('Biblioteca BIB', 'bib')).toBe(true);
    expect(matches('Biblioteca', '')).toBe(true);
  });
});

describe('Ctrl+K quick wake (FR-004.7)', () => {
  it('AC-004-17: Ctrl+K, "lab 3", Enter opens the preview for that room', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp('/salas');
    await screen.findByRole('heading', { level: 1, name: 'Salas' });
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Ligar rapidamente' });
    const input = within(palette).getByRole('combobox', { name: 'Sala, etiqueta ou máquina' });
    expect(input).toHaveFocus();
    await user.type(input, 'lab 3');
    const options = within(palette).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['SalaLaboratório 313 máquina(s)']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('dialog', { name: 'Ligar sala Laboratório 3' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Ligar rapidamente' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(calls.calls.find((c) => c.path === '/api/wake/preview')?.body).toEqual({
        target: { type: 'rooms', roomIds: [3], includeNoRoom: false },
        onlyOffline: false,
      }),
    );
  });

  it('lists rooms, tags and devices; arrows move the selection; Escape closes', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp('/salas');
    await screen.findByRole('heading', { level: 1, name: 'Salas' });
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Ligar rapidamente' });
    const input = within(palette).getByRole('combobox');
    await user.type(input, 'proj');
    await within(palette).findByText('PROJ-PC');
    const options = within(palette).getAllByRole('option');
    expect(options.map((o) => o.firstElementChild?.textContent)).toEqual(['Etiqueta', 'Máquina']);
    await user.keyboard('{ArrowDown}');
    expect(within(palette).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      within(palette).getAllByRole('option')[1]!.id,
    );
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(calls.calls.find((c) => c.path === '/api/wake/preview')?.body).toMatchObject({
        target: { type: 'devices', deviceIds: [9] },
      }),
    );
    await user.keyboard('{Escape}');
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Ligar rapidamente' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Ligar rapidamente' })).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    api();
    const user = userEvent.setup();
    renderApp('/salas');
    await screen.findByRole('heading', { level: 1, name: 'Salas' });
    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('combobox'), 'zzz');
    expect(await screen.findByText('Nada encontrado.')).toBeInTheDocument();
  });
});
