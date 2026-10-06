import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryState } from '@uniwake/shared';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const at = (h: number) => new Date(2026, 9, 6, h).getTime();
const SUBNETS = [
  { name: 'Ethernet', cidr: '10.0.3.0/24', hosts: 254 },
  { name: 'Corporativa', cidr: '172.16.0.0/20', hosts: 4094 },
];
const IDLE: DiscoveryState = {
  state: 'idle',
  cidr: null,
  startedAt: null,
  finishedAt: null,
  probed: 0,
  total: 0,
  error: null,
  found: [],
  subnets: SUBNETS,
};
const DONE: DiscoveryState = {
  ...IDLE,
  state: 'done',
  cidr: '10.0.3.0/24',
  startedAt: at(9),
  finishedAt: at(9),
  probed: 254,
  total: 254,
  found: [
    {
      ip: '10.0.3.41',
      mac: '00:1A:2B:3C:4D:41',
      vendor: 'Dell Inc.',
      hostname: null,
      latencyMs: 2,
      firstSeenAt: at(9),
      lastSeenAt: at(9),
      registered: { id: 7, name: 'PC-41' },
      locallyAdministered: false,
    },
    {
      ip: '10.0.3.42',
      mac: '02:AA:BB:CC:DD:42',
      vendor: null,
      hostname: 'LAB3-PC42',
      latencyMs: 5,
      firstSeenAt: at(9),
      lastSeenAt: at(9),
      registered: null,
      locallyAdministered: true,
    },
  ],
};

function api(state: DiscoveryState = IDLE): FakeApi {
  return loggedInApi()
    .on('GET', '/api/discovery', { body: state })
    .on('GET', '/api/rooms', { body: [{ id: 3, name: 'Lab 3', code: 'LAB3', deviceCount: 0 }] })
    .on('POST', '/api/discovery/add', { body: { added: 1, skipped: [] } });
}

describe('Descobrir na rede (FR-101)', () => {
  it("says discovery only sees this computer's networks and offers them", async () => {
    api();
    renderApp('/dispositivos/descobrir');
    expect(await screen.findByText(/só enxerga as redes deste computador/)).toBeInTheDocument();
    expect(screen.getByLabelText('Rede')).toHaveValue('10.0.3.0/24');
  });

  it('AC-101-01: a network larger than /22 asks for confirmation before sweeping', async () => {
    const fake = api().on('POST', '/api/discovery/scan', (body) =>
      (body as { confirmLarge?: boolean }).confirmLarge
        ? { status: 202, body: { ...IDLE, state: 'running', cidr: '172.16.0.0/20', total: 4094 } }
        : {
            status: 422,
            body: {
              code: 'VALIDATION_FAILED',
              message: 'Dados inválidos.',
              details: [{ path: 'confirmLarge', message: 'Esta rede tem 4094 endereços.' }],
            },
          },
    );
    const user = userEvent.setup();
    renderApp('/dispositivos/descobrir');
    await user.selectOptions(await screen.findByLabelText('Rede'), '172.16.0.0/20');
    await user.click(screen.getByRole('button', { name: 'Varrer rede' }));
    const dialog = await screen.findByRole('dialog', { name: 'Varrer uma rede grande?' });
    await user.click(within(dialog).getByRole('button', { name: 'Varrer mesmo assim' }));
    await waitFor(() =>
      expect(fake.calls.filter((c) => c.path === '/api/discovery/scan').map((c) => c.body)).toEqual(
        [{ cidr: '172.16.0.0/20' }, { cidr: '172.16.0.0/20', confirmLarge: true }],
      ),
    );
  });

  it('AC-101-03: registered machines are "já cadastrado" and cannot be selected; others are added to a room', async () => {
    const fake = api(DONE);
    const user = userEvent.setup();
    renderApp('/dispositivos/descobrir');
    const table = await screen.findByRole('table', { name: 'Computadores encontrados' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('já cadastrado: PC-41');
    expect(within(rows[0]!).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('MAC virtual/aleatório');
    await user.click(within(rows[1]!).getByRole('checkbox', { name: 'Adicionar 10.0.3.42' }));
    expect(within(rows[1]!).getByLabelText('Nome de 10.0.3.42')).toHaveValue('LAB3-PC42');
    await user.selectOptions(screen.getByLabelText('Sala'), 'Lab 3');
    await user.click(screen.getByRole('button', { name: 'Adicionar 1 selecionado(s)' }));
    await waitFor(() =>
      expect(fake.calls.find((c) => c.path === '/api/discovery/add')?.body).toEqual({
        roomId: 3,
        devices: [
          { mac: '02:AA:BB:CC:DD:42', ip: '10.0.3.42', name: 'LAB3-PC42', hostname: 'LAB3-PC42' },
        ],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('1 computador(es) adicionado(s).');
  });

  it('shows progress while sweeping', async () => {
    api({ ...IDLE, state: 'running', cidr: '10.0.3.0/24', probed: 100, total: 254 });
    renderApp('/dispositivos/descobrir');
    expect(
      await screen.findByText('Varrendo 10.0.3.0/24: 100 de 254 endereços testados…'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Varrendo…' })).toBeDisabled();
  });
});
