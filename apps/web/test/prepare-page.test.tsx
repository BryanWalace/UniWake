import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreatedEnrollmentToken, EnrollmentAddresses, EnrollmentToken } from '@uniwake/shared';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m).getTime();
const ROOMS = [
  { id: 3, name: 'Lab 3', code: 'LAB3', deviceCount: 0 },
  { id: 4, name: 'Lab 4', code: 'LAB4', deviceCount: 0 },
];
const ADDRESSES: EnrollmentAddresses = {
  addresses: [
    { address: '10.0.3.5', interfaceName: 'Ethernet', hasGateway: true },
    { address: '192.168.56.1', interfaceName: 'VirtualBox', hasGateway: false },
  ],
  selected: '10.0.3.5',
  agentPort: 47101,
};
const TOKEN: EnrollmentToken = {
  id: 9,
  roomId: 3,
  roomName: 'Lab 3',
  roomCode: 'LAB3',
  createdBy: 'ana',
  createdAt: at(8),
  expiresAt: at(16),
  maxUses: 100,
  uses: 3,
  revokedAt: null,
  state: 'ativo',
};
const CREATED: CreatedEnrollmentToken = {
  ...TOKEN,
  id: 10,
  uses: 0,
  token: 'abcDEF_123-xyz456789',
};
const commandFor = (address: string) => ({
  command: `& { Invoke-WebRequest -Uri 'http://${address}:47101/agent/prepare-target.ps1' }`,
  hubUrl: `http://${address}:47101`,
  scriptUrl: `http://${address}:47101/agent/prepare-target.ps1`,
  sha256: 'ab12cd34ef56'.padEnd(64, '0'),
  roomCode: 'LAB3',
});

function api(tokens: EnrollmentToken[] = [TOKEN]): FakeApi {
  return loggedInApi()
    .on('GET', '/api/rooms', { body: ROOMS })
    .on('GET', '/api/enrollment/tokens', { body: tokens })
    .on('GET', '/api/enrollment/addresses', { body: ADDRESSES })
    .on('POST', '/api/enrollment/tokens', { status: 201, body: CREATED })
    .on('POST', '/api/enrollment/command', (body) => ({
      body: commandFor((body as { address: string }).address),
    }));
}

describe('Preparar máquinas (FR-007.3)', () => {
  it('generates a code for a room and shows the one-line command with a copy button', async () => {
    const fake = api();
    const user = userEvent.setup();
    renderApp('/preparar');
    await user.selectOptions(await screen.findByLabelText('Sala'), 'Lab 3 (LAB3)');
    await user.type(screen.getByLabelText('Validade (horas)'), '4');
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));
    const section = await screen.findByRole('region', { name: '2. Comando para a sala Lab 3' });
    expect(
      fake.calls.find((c) => c.path === '/api/enrollment/tokens' && c.method === 'POST')?.body,
    ).toEqual({
      roomId: 3,
      expiresHours: 4,
    });
    expect(section).toHaveTextContent('Este código aparece só agora');
    expect(section).toHaveTextContent('para até 100 computadores');
    const box = await within(section).findByLabelText('Comando (PowerShell como Administrador)');
    expect(box).toHaveValue(commandFor('10.0.3.5').command);
    expect(fake.calls.find((c) => c.path === '/api/enrollment/command')?.body).toEqual({
      token: 'abcDEF_123-xyz456789',
      address: '10.0.3.5',
    });
    await user.click(within(section).getByRole('button', { name: 'Copiar comando' }));
    expect(await within(section).findByRole('status')).toHaveTextContent('Comando copiado.');
    expect(await navigator.clipboard.readText()).toBe(commandFor('10.0.3.5').command);
    expect(section).toHaveTextContent('Arquivo alterado — não execute');
  });

  it('rebuilds the command when another address of this computer is chosen', async () => {
    api();
    const user = userEvent.setup();
    renderApp('/preparar');
    await user.selectOptions(await screen.findByLabelText('Sala'), 'Lab 3 (LAB3)');
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));
    const select = await screen.findByLabelText('Endereço do UniWake que os computadores vão usar');
    expect(select).toHaveValue('10.0.3.5');
    await user.selectOptions(select, '192.168.56.1');
    await waitFor(() =>
      expect(screen.getByLabelText('Comando (PowerShell como Administrador)')).toHaveValue(
        commandFor('192.168.56.1').command,
      ),
    );
  });

  it('asks for a room before generating', async () => {
    const fake = api();
    const user = userEvent.setup();
    renderApp('/preparar');
    await user.click(await screen.findByRole('button', { name: 'Gerar código' }));
    expect(await screen.findByText('Escolha a sala.')).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the hub error when no command can be built', async () => {
    api().on('POST', '/api/enrollment/command', {
      status: 503,
      body: {
        code: 'PREPARE_SCRIPT_MISSING',
        message: 'O arquivo prepare-target.ps1 não foi encontrado na instalação do UniWake.',
      },
    });
    const user = userEvent.setup();
    renderApp('/preparar');
    await user.selectOptions(await screen.findByLabelText('Sala'), 'Lab 3 (LAB3)');
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));
    expect(await screen.findByText(/prepare-target.ps1 não foi encontrado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copiar comando' })).not.toBeInTheDocument();
  });

  it('warns when this computer has no usable address', async () => {
    api().on('GET', '/api/enrollment/addresses', {
      body: { addresses: [], selected: null, agentPort: 47101 },
    });
    const user = userEvent.setup();
    renderApp('/preparar');
    await user.selectOptions(await screen.findByLabelText('Sala'), 'Lab 3 (LAB3)');
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não tem uma placa de rede');
    expect(
      screen.queryByRole('link', { name: 'Baixar prepare-target.ps1' }),
    ).not.toBeInTheDocument();
  });

  it('lists codes with their use counts and revokes an active one after confirmation', async () => {
    const used: EnrollmentToken = { ...TOKEN, id: 8, uses: 100, state: 'esgotado' };
    const fake = api([TOKEN, used]).on('POST', '/api/enrollment/tokens/9/revoke', {
      body: { ...TOKEN, state: 'revogado', revokedAt: at(9) },
    });
    const user = userEvent.setup();
    renderApp('/preparar');
    const table = await screen.findByRole('table', { name: 'Códigos de cadastro' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Lab 3ana05/10/2026 16:003 de 100Ativo');
    expect(rows[1]).toHaveTextContent('100 de 100Limite de usos atingido');
    expect(within(rows[1]!).queryByRole('button')).not.toBeInTheDocument();
    await user.click(
      within(rows[0]!).getByRole('button', { name: /^Revogar código da sala Lab 3/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Revogar código de cadastro' });
    await user.click(within(dialog).getByRole('button', { name: 'Revogar' }));
    await waitFor(() =>
      expect(fake.calls.some((c) => c.path === '/api/enrollment/tokens/9/revoke')).toBe(true),
    );
  });

  it('has the BIOS checklist and a plain download of the script for offline use', async () => {
    api();
    renderApp('/preparar');
    const link = await screen.findByRole('link', { name: 'Baixar prepare-target.ps1' });
    expect(link).toHaveAttribute('href', 'http://10.0.3.5:47101/agent/prepare-target.ps1');
    const bios = screen.getByRole('region', { name: 'Conferir na BIOS/UEFI' });
    for (const brand of ['Dell:', 'HP:', 'Lenovo:']) expect(bios).toHaveTextContent(brand);
  });
});
