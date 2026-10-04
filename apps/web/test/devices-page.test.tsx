import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '@uniwake/shared';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

function device(id: number, patch: Partial<Device> = {}): Device {
  return {
    id,
    name: `PC-0${id}`,
    mac: `00:AA:00:00:00:0${id}`,
    ip: `10.0.3.2${id}`,
    hostname: null,
    roomId: 1,
    tagIds: [],
    notes: null,
    enabled: true,
    manufacturer: null,
    model: null,
    serial: null,
    os: null,
    otherMacs: [],
    preparedAt: null,
    enrolledAt: null,
    createdAt: 0,
    updatedAt: 0,
    status: 'online',
    latencyMs: 2,
    lastSeenAt: 0,
    onlineSince: 0,
    everOnline: true,
    flags: { macLocallyAdministered: false, neverResponded: false },
    ...patch,
  };
}

function inventoryApi(
  devices: Device[] = [device(1), device(2, { status: 'offline', roomId: 2 })],
): FakeApi {
  return loggedInApi()
    .on('GET', '/api/rooms', {
      body: [
        { id: 1, name: 'Lab 1', code: 'LAB1', deviceCount: 1 },
        { id: 2, name: 'Lab 2', code: 'LAB2', deviceCount: 1 },
      ],
    })
    .on('GET', '/api/tags', {
      body: [{ id: 7, name: 'professor', color: '#aa0000', deviceCount: 0 }],
    })
    .on('GET', '/api/devices', (_b, url) => {
      const status = url.searchParams.get('status');
      const items = status ? devices.filter((d) => d.status === status) : devices;
      return { body: { items, total: items.length, page: 1, pageSize: 50 } };
    });
}

describe('devices page (FR-002)', () => {
  it('lists devices with status text, room names and pagination summary', async () => {
    inventoryApi();
    renderApp('/dispositivos');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('PC-01')).toBeInTheDocument();
    expect(within(table).getByText('Ligado')).toBeInTheDocument();
    expect(within(table).getByText('Desligado')).toBeInTheDocument();
    expect(within(table).getByText('Lab 2')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 1–2 de 2')).toBeInTheDocument();
  });

  it('shows loading, empty and error states', async () => {
    inventoryApi([]);
    const { unmount } = renderApp('/dispositivos');
    expect(screen.getByRole('status')).toHaveTextContent('Carregando');
    expect(await screen.findByText('Nenhum dispositivo encontrado')).toBeInTheDocument();
    unmount();
    loggedInApi()
      .on('GET', '/api/rooms', { body: [] })
      .on('GET', '/api/tags', { body: [] })
      .on('GET', '/api/devices', {
        status: 500,
        body: { code: 'INTERNAL_ERROR', message: 'Erro interno inesperado.' },
      });
    renderApp('/dispositivos');
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro interno inesperado.');
  });

  it('turns filters into API query parameters', async () => {
    const api = inventoryApi();
    const user = userEvent.setup();
    renderApp('/dispositivos');
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Status'), 'offline');
    await user.selectOptions(screen.getByLabelText('Sala'), 'none');
    await waitFor(() => {
      const last = api.calls.filter((c) => c.path === '/api/devices').at(-1);
      expect(last).toBeDefined();
    });
    expect(await screen.findByText('PC-02')).toBeInTheDocument();
    expect(screen.queryByText('PC-01')).not.toBeInTheDocument();
  });

  it('AC-002-06 creating a second "PC-01" succeeds and shows the duplicate-name warning', async () => {
    const api = inventoryApi().on('POST', '/api/devices', (body) => ({
      status: 201,
      body: {
        device: device(9, { name: (body as { name: string }).name }),
        warnings: ['duplicate_name'],
      },
    }));
    const user = userEvent.setup();
    renderApp('/dispositivos');
    await user.click(await screen.findByRole('button', { name: 'Novo dispositivo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo dispositivo' });
    await user.type(within(dialog).getByLabelText('Nome'), 'PC-01');
    await user.type(within(dialog).getByLabelText(/^MAC/), '00-aa-00-00-00-09');
    await user.selectOptions(within(dialog).getByLabelText('Sala'), '2');
    await user.click(within(dialog).getByLabelText('professor'));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await screen.findByText(/Já existe outro dispositivo com este nome/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      name: 'PC-01',
      mac: '00-aa-00-00-00-09',
      roomId: 2,
      tagIds: [7],
      enabled: true,
    });
  });

  it('maps a duplicate MAC and validation details to the right fields', async () => {
    let attempt = 0;
    inventoryApi().on('POST', '/api/devices', () => {
      attempt++;
      return attempt === 1
        ? {
            status: 409,
            body: {
              code: 'DEVICE_MAC_DUPLICATE',
              message: 'O MAC já está cadastrado no dispositivo "PC-01".',
            },
          }
        : {
            status: 422,
            body: {
              code: 'VALIDATION_FAILED',
              message: 'Dados inválidos.',
              details: [{ path: 'ip', message: 'IP inválido.' }],
            },
          };
    });
    const user = userEvent.setup();
    renderApp('/dispositivos');
    await user.click(await screen.findByRole('button', { name: 'Novo dispositivo' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome'), 'X');
    await user.type(within(dialog).getByLabelText(/^MAC/), '00:AA:00:00:00:01');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('O MAC já está cadastrado no dispositivo "PC-01".'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^MAC/)).toHaveAttribute('aria-invalid', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await within(dialog).findByText('IP inválido.')).toBeInTheDocument();
  });

  it('Escape closes the dialog', async () => {
    inventoryApi();
    const user = userEvent.setup();
    renderApp('/dispositivos');
    await user.click(await screen.findByRole('button', { name: 'Novo dispositivo' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('bulk-moves selected devices and confirms bulk delete with the count', async () => {
    const api = inventoryApi().on('POST', '/api/devices/bulk', () => ({ body: { affected: 2 } }));
    const user = userEvent.setup();
    renderApp('/dispositivos');
    await user.click(await screen.findByLabelText('Selecionar todos desta página'));
    const bar = screen.getByRole('region', { name: 'Ações em lote' });
    expect(bar).toHaveTextContent('2 selecionado(s)');
    await user.selectOptions(within(bar).getByLabelText('Mover para'), '1');
    await user.click(within(bar).getByRole('button', { name: 'Mover' }));
    expect(await screen.findByText('2 dispositivo(s) movido(s).')).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/api/devices/bulk')?.body).toEqual({
      action: 'move',
      deviceIds: [1, 2],
      roomId: 1,
    });

    await user.click(screen.getByLabelText('Selecionar PC-01'));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    const confirm = await screen.findByRole('dialog', { name: 'Excluir dispositivos' });
    expect(confirm).toHaveTextContent('Excluir 1 dispositivo(s)?');
    await user.click(within(confirm).getByRole('button', { name: 'Excluir 1 dispositivo(s)' }));
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === '/api/devices/bulk').at(-1)?.body).toEqual({
        action: 'delete',
        deviceIds: [1],
        confirm: true,
      }),
    );
  });
});
