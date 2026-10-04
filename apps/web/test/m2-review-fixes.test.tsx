import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const emptyPage = { items: [], total: 0, page: 1, pageSize: 50 };

describe('M2 review fixes (web)', () => {
  it('R-M2-03 typing in the search box sends one request after the user pauses', async () => {
    const api = loggedInApi()
      .on('GET', '/api/rooms', { body: [] })
      .on('GET', '/api/tags', { body: [] })
      .on('GET', '/api/devices', { body: emptyPage });
    const user = userEvent.setup();
    renderApp('/dispositivos');
    await user.type(await screen.findByLabelText('Buscar'), 'LAB3-PC');
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === '/api/devices' && c.body === undefined)).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 400));
    const searches = api.calls.filter((c) => c.path === '/api/devices').length;
    // initial load + one debounced search, not one per keystroke (7 letters)
    expect(searches).toBeLessThanOrEqual(3);
  });

  it('R-M2-04 the room page says when it shows only part of the devices and links to the full list', async () => {
    const api = loggedInApi()
      .on('GET', '/api/rooms', { body: [{ id: 3, name: 'Lab 3', code: 'LAB3', deviceCount: 250 }] })
      .on('GET', '/api/tags', { body: [] })
      .on('GET', '/api/rooms/3', {
        body: { id: 3, name: 'Lab 3', code: 'LAB3', block: null, floor: null, deviceCount: 250 },
      })
      .on('GET', '/api/devices', (_b, url) => ({
        body: {
          items:
            url.searchParams.get('roomId') === '3' && url.searchParams.get('pageSize') === '200'
              ? [
                  {
                    id: 1,
                    name: 'PC-1',
                    mac: '00:AA:00:00:00:01',
                    ip: null,
                    roomId: 3,
                    tagIds: [],
                    enabled: true,
                    status: 'online',
                    flags: { macLocallyAdministered: false },
                  },
                ]
              : [],
          total: 250,
          page: 1,
          pageSize: 200,
        },
      }));
    const user = userEvent.setup();
    renderApp('/salas/3');
    expect(await screen.findByText(/Mostrando 1 de 250 máquinas/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Ver todas em Dispositivos' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === '/api/devices' && c.body === undefined)).toBe(true),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dispositivos' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Sala')).toHaveValue('3');
  });
});
