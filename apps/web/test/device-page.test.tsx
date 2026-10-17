import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceDiagnostics, DeviceHistoryItem } from '@uniwake/shared';
import { historyText } from '../src/features/devices/DevicePage';
import { type FakeApi, loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const PC: Device = {
  id: 5,
  name: 'LAB1-PC05',
  mac: '00:AA:00:00:00:05',
  ip: '10.0.3.25',
  hostname: 'lab1-pc05',
  roomId: 1,
  tagIds: [7],
  notes: 'Mesa do fundo',
  enabled: true,
  neverScheduledShutdown: false,
  manufacturer: null,
  model: null,
  serial: null,
  os: null,
  otherMacs: [],
  preparedAt: null,
  enrolledAt: null,
  createdAt: 0,
  updatedAt: 0,
  status: 'offline',
  latencyMs: null,
  lastSeenAt: null,
  onlineSince: null,
  everOnline: false,
  flags: { macLocallyAdministered: false, neverResponded: true },
};

const at = (h: number) => Date.UTC(2026, 9, 5, h, 0);

const DIAG: DeviceDiagnostics = {
  deviceId: 5,
  problems: [
    {
      code: 'nunca_respondeu',
      title: 'Nunca respondeu',
      message:
        'Esta máquina nunca respondeu às verificações. Se ela estiver ligada, o firewall do Windows provavelmente bloqueia ping (ICMP) e as portas 135, 445 e 3389.',
      help: 'firewall-icmp',
    },
  ],
  mac: '00:AA:00:00:00:05',
  macLocallyAdministered: false,
  otherMacs: [],
  wake: {
    attempts: 0,
    successes: 0,
    successRate: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    stoppedWaking: false,
  },
  network: {
    deviceIp: '10.0.3.25',
    interfaces: [{ name: 'Ethernet', address: '10.0.3.5', prefixLength: 24 }],
    sameSubnet: true,
    destinations: [{ sourceIp: '10.0.3.5', destination: '255.255.255.255' }],
  },
  lastTestWol: null,
  prepare: { preparedAt: null, enrolledAt: null, results: null },
};

function deviceApi(over: Partial<Device> = {}, diag: Partial<DeviceDiagnostics> = {}): FakeApi {
  return loggedInApi()
    .on('GET', '/api/devices/5/agent', {
      body: { deviceId: 5, readiness: 'needs_preparation', agentVersion: null, lastCheckin: null },
    })
    .on('GET', '/api/devices/5/diagnostics', { body: { ...DIAG, ...diag } })
    .on('GET', '/api/devices/5', { body: { ...PC, ...over } })
    .on('GET', '/api/rooms', {
      body: [
        {
          id: 1,
          name: 'Lab 1',
          code: 'LAB1',
          block: null,
          floor: null,
          color: '#000',
          deviceCount: 1,
        },
      ],
    })
    .on('GET', '/api/tags', {
      body: [{ id: 7, name: 'Projetor', color: '#0891b2', deviceCount: 1 }],
    })
    .on('GET', '/api/uptime', (_b, url) => ({
      body: {
        days: [
          { day: '2026-10-04', ratio: 1 / 6 },
          { day: '2026-10-05', ratio: null },
        ].slice(0, Number(url.searchParams.get('days')) >= 7 ? 2 : 1),
        average: 1 / 6,
      },
    }))
    .on('GET', '/api/devices/5/history', (_b, url) =>
      url.searchParams.get('before')
        ? {
            body: {
              items: [{ kind: 'status', at: at(1), from: null, to: 'offline', reason: null }],
              nextBefore: null,
            },
          }
        : {
            body: {
              items: [
                {
                  kind: 'wake',
                  at: at(9),
                  jobId: 12,
                  source: 'schedule',
                  result: 'nao_respondeu',
                  dryRun: false,
                  wokeAt: null,
                },
                { kind: 'ip_changed', at: at(8), from: '10.0.3.20', to: '10.0.3.25' },
              ],
              nextBefore: at(8),
            },
          },
    );
}

describe('device page (FR-004.6)', () => {
  it('shows data, daily uptime and history, and loads older history on demand', async () => {
    const api = deviceApi();
    const user = userEvent.setup();
    renderApp('/dispositivos/5');
    expect(await screen.findByRole('heading', { level: 1, name: 'LAB1-PC05' })).toBeInTheDocument();
    const data = screen.getByRole('region', { name: 'Dados' });
    expect(within(data).getByText('10.0.3.25')).toBeInTheDocument();
    expect(await within(data).findByRole('link', { name: 'Lab 1' })).toHaveAttribute(
      'href',
      '/salas/1',
    );
    expect(await within(data).findByText('Projetor')).toBeInTheDocument();
    expect(within(data).getByText('Mesa do fundo')).toBeInTheDocument();

    const uptime = screen.getByRole('region', { name: 'Disponibilidade' });
    expect(await within(uptime).findByText('16,7%', { selector: 'strong' })).toBeInTheDocument();
    const days = within(uptime).getByRole('list', { name: 'Disponibilidade por dia' });
    expect(
      within(days)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['05/10/2026—', '04/10/202616,7%']);

    const history = screen.getByRole('region', { name: 'Histórico' });
    expect(
      await within(history).findByText('Ligar (agendamento): não respondeu'),
    ).toBeInTheDocument();
    expect(within(history).getByRole('link', { name: 'ver ligação' })).toHaveAttribute(
      'href',
      '/historico/jobs/12',
    );
    expect(within(history).getByText('IP mudou de 10.0.3.20 para 10.0.3.25')).toBeInTheDocument();
    await user.click(within(history).getByRole('button', { name: 'Carregar mais' }));
    expect(await within(history).findByText('Ficou desligada')).toBeInTheDocument();
    expect(
      within(history).queryByRole('button', { name: 'Carregar mais' }),
    ).not.toBeInTheDocument();
    const older = api.calls.filter((c) => c.path === '/api/devices/5/history');
    expect(older).toHaveLength(2);
  });

  it('AC-004-12: a device never seen online shows "Nunca respondeu" with the firewall hint', async () => {
    deviceApi();
    renderApp('/dispositivos/5');
    const diag = await screen.findByRole('region', { name: 'Diagnóstico' });
    expect(await within(diag).findByText('Nunca respondeu')).toBeInTheDocument();
    expect(within(diag).getByText(/firewall do Windows/)).toBeInTheDocument();
    expect(
      within(diag).getByRole('link', { name: 'Como resolver: Firewall e ping (ICMP)' }),
    ).toHaveAttribute('href', '/ajuda/firewall-icmp');
    expect(diag).toHaveAttribute('id', 'diagnostico');
  });

  it('AC-007-15: "parou de acordar" links to its help page; wake stats and the last test are shown', async () => {
    deviceApi(
      {},
      {
        problems: [
          {
            code: 'parou_de_acordar',
            title: 'Parou de acordar',
            message: 'Ligava pela rede, mas não respondeu às últimas 3 tentativas.',
            help: 'fast-startup',
          },
        ],
        wake: {
          attempts: 8,
          successes: 5,
          successRate: 0.625,
          lastSuccessAt: at(6),
          consecutiveFailures: 3,
          stoppedWaking: true,
        },
        lastTestWol: {
          id: 3,
          deviceId: 5,
          deviceName: 'LAB1-PC05',
          state: 'nao_acordou',
          requestedBy: 'admin',
          startedAt: at(7),
          offlineAt: at(7),
          sentAt: at(7),
          finishedAt: at(8),
          jobId: 9,
          detail: null,
        },
        prepare: { preparedAt: at(5), enrolledAt: at(5), results: { 'Fast Startup': 'OK' } },
      },
    );
    renderApp('/dispositivos/5');
    const diag = await screen.findByRole('region', { name: 'Diagnóstico' });
    const problems = await within(diag).findByRole('list', { name: 'Problemas encontrados' });
    expect(problems).toHaveTextContent('Parou de acordar');
    expect(
      within(problems).getByRole('link', {
        name: 'Como resolver: Inicialização Rápida (Fast Startup)',
      }),
    ).toHaveAttribute('href', '/ajuda/fast-startup');
    expect(diag).toHaveTextContent('63% (5 de 8)');
    expect(diag).toHaveTextContent('Não acordou em');
    expect(diag).toHaveTextContent('Fast Startup: OK');
  });

  it('AC-010-02: a device on another subnet shows "Dispositivo em outra sub-rede" with the VLAN help', async () => {
    deviceApi(
      {},
      {
        problems: [
          {
            code: 'outra_subrede',
            title: 'Dispositivo em outra sub-rede',
            message: 'O IP 10.0.9.5 não está na rede de nenhuma placa do UniWake (10.0.3.0/24).',
            help: 'vlan-broadcast',
          },
        ],
        network: { ...DIAG.network, deviceIp: '10.0.9.5', sameSubnet: false },
      },
    );
    renderApp('/dispositivos/5');
    const diag = await screen.findByRole('region', { name: 'Diagnóstico' });
    expect(await within(diag).findByText('Dispositivo em outra sub-rede')).toBeInTheDocument();
    expect(
      within(diag).getByRole('link', {
        name: 'Como resolver: Redes diferentes (VLAN) e broadcast',
      }),
    ).toHaveAttribute('href', '/ajuda/vlan-broadcast');
  });

  it('"Ligar" previews a wake for this device only', async () => {
    const api = deviceApi().on('POST', '/api/wake/preview', {
      body: {
        count: 1,
        rooms: [{ roomId: 1, name: 'Lab 1', count: 1 }],
        excluded: [],
        needsConfirmation: false,
      },
    });
    const user = userEvent.setup();
    renderApp('/dispositivos/5');
    await user.click(await screen.findByRole('button', { name: 'Ligar' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.path === '/api/wake/preview')?.body).toMatchObject({
        target: { type: 'devices', deviceIds: [5] },
      }),
    );
  });

  it('shows a clear message for an unknown device', async () => {
    loggedInApi().on('GET', '/api/devices/77', {
      status: 404,
      body: {
        code: 'NOT_FOUND',
        message: 'Item não encontrado. Ele pode ter sido removido; atualize a página.',
      },
    });
    renderApp('/dispositivos/77');
    expect(await screen.findByText('Máquina não encontrada')).toBeInTheDocument();
  });
});

describe('historyText', () => {
  it('describes every kind of history line in pt-BR', () => {
    const cases: [DeviceHistoryItem, string][] = [
      [{ kind: 'status', at: 0, from: 'offline', to: 'online', reason: null }, 'Ficou ligada'],
      [
        { kind: 'status', at: 0, from: 'online', to: 'desconhecido', reason: 'hub_start' },
        'Status desconhecido (o UniWake foi reiniciado)',
      ],
      [
        { kind: 'ip_changed', at: 0, from: null, to: '10.0.0.9' },
        'IP mudou de (sem IP) para 10.0.0.9',
      ],
      [{ kind: 'moved', at: 0, data: {} }, 'Mudou de sala'],
      [{ kind: 'enrolled', at: 0, data: {} }, 'Cadastrada pelo agente'],
      [
        {
          kind: 'wake',
          at: 0,
          jobId: 1,
          source: 'manual',
          result: 'acordou',
          dryRun: true,
          wokeAt: 1,
        },
        'Ligar (manual, simulação): acordou',
      ],
    ];
    for (const [item, text] of cases) expect(historyText(item)).toBe(text);
  });
});

describe('Testar WoL desta máquina (FR-007.4)', () => {
  const RUN = {
    id: 21,
    deviceId: 5,
    deviceName: 'LAB1-PC05',
    state: 'aguardando_desligar',
    requestedBy: 'admin',
    startedAt: at(9),
    offlineAt: null,
    sentAt: null,
    finishedAt: null,
    jobId: null,
    detail: null,
  };

  it('guides the test and shows the result with a link to the job', async () => {
    let gets = 0;
    const api = deviceApi()
      .on('POST', '/api/devices/5/test-wol', { status: 201, body: RUN })
      .on('GET', '/api/test-wol/21', () =>
        gets++ === 0
          ? { body: RUN }
          : {
              body: {
                ...RUN,
                state: 'sucesso',
                offlineAt: at(9) + 20_000,
                sentAt: at(9) + 50_000,
                finishedAt: at(9) + 120_000,
                jobId: 40,
              },
            },
      );
    const user = userEvent.setup();
    renderApp('/dispositivos/5');
    await user.click(await screen.findByRole('button', { name: 'Testar WoL' }));
    const dialog = await screen.findByRole('dialog', { name: 'Testar WoL: LAB1-PC05' });
    expect(dialog).toHaveTextContent('desligue a máquina pelo menu Iniciar');
    await user.click(within(dialog).getByRole('button', { name: 'Começar teste' }));
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/devices/5/test-wol')).toBe(
      true,
    );
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Aguardando o computador desligar: desligue a máquina pelo menu Iniciar.',
    );
    // Progress is polled every 2 s while the test runs.
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('Sucesso'), {
      timeout: 5_000,
    });
    expect(dialog).toHaveTextContent('Máquina desligada às');
    expect(dialog).toHaveTextContent('Magic Packet enviado às');
    expect(
      within(dialog).getByRole('link', { name: 'Ver a ligação no histórico' }),
    ).toHaveAttribute('href', '/historico/jobs/40');
  });

  it('can be cancelled, and "não acordou" points to the preparation help', async () => {
    const api = deviceApi()
      .on('POST', '/api/devices/5/test-wol', { status: 201, body: RUN })
      .on('GET', '/api/test-wol/21', { body: RUN })
      .on('POST', '/api/test-wol/21/cancel', {
        body: { ...RUN, state: 'cancelado', finishedAt: at(9) + 5_000 },
      });
    const user = userEvent.setup();
    renderApp('/dispositivos/5');
    await user.click(await screen.findByRole('button', { name: 'Testar WoL' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Começar teste' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Cancelar teste' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Cancelado');
    expect(api.calls.some((c) => c.path === '/api/test-wol/21/cancel')).toBe(true);
  });

  it('shows why a test cannot start', async () => {
    deviceApi().on('POST', '/api/devices/5/test-wol', {
      status: 422,
      body: {
        code: 'VALIDATION_FAILED',
        message: 'Dados inválidos.',
        details: [{ path: 'ip', message: 'Cadastre o IP ou o nome do computador.' }],
      },
    });
    const user = userEvent.setup();
    renderApp('/dispositivos/5');
    await user.click(await screen.findByRole('button', { name: 'Testar WoL' }));
    await user.click(await screen.findByRole('button', { name: 'Começar teste' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('"Desligamento remoto" card (M19-T03, FR-309, owner Q-3/Q-6)', () => {
  const AGENT = {
    deviceId: 5,
    readiness: 'ready',
    agentVersion: '1.3.0',
    lastCheckin: at(9),
    freezeProduct: 'deep_freeze',
    freezeState: 'frozen',
    persistentArea: true,
    sleepAfterMinutes: 30,
    wakeTimers: 'enabled',
    userLoggedOn: true,
    sessions: 2,
    clockOffsetMs: 5 * 60_000,
    tokenRotatedAt: null,
  };

  it('shows the agent details without user names and lets an admin revoke it', async () => {
    const api = deviceApi()
      .on('GET', '/api/devices/5/agent', { body: AGENT })
      .on('POST', '/api/devices/5/agent/revoke', { body: { ...AGENT, readiness: 'revoked' } });
    const user = userEvent.setup();
    renderApp('/dispositivos/5');
    const card = await screen.findByRole('region', { name: 'Desligamento remoto' });
    expect(await within(card).findByText('Pronta para desligar')).toBeInTheDocument();
    expect(card).toHaveTextContent('1.3.0');
    expect(card).toHaveTextContent('Deep Freeze');
    expect(card).toHaveTextContent('após 30 minutos');
    expect(card).toHaveTextContent('ativados');
    expect(card).toHaveTextContent('sim (2 sessões)');
    expect(card).toHaveTextContent('5 min atrasado');
    await user.click(within(card).getByRole('button', { name: 'Revogar desligamento remoto' }));
    const dialog = await screen.findByRole('dialog', {
      name: /Revogar desligamento remoto de LAB1-PC05/,
    });
    await user.click(within(dialog).getByRole('button', { name: 'Revogar' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === '/api/devices/5/agent/revoke')).toBe(true),
    );
  });

  it('asks for the new preparation when the machine has no agent', async () => {
    deviceApi().on('GET', '/api/devices/5/agent', {
      body: { ...AGENT, readiness: 'needs_preparation', agentVersion: null, lastCheckin: null },
    });
    renderApp('/dispositivos/5');
    const card = await screen.findByRole('region', { name: 'Desligamento remoto' });
    expect(await within(card).findByText(/comando atualizado de "Preparar/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Revogar/ })).not.toBeInTheDocument();
    expect(
      within(card).getByRole('link', { name: /Como resolver: Desligar computadores/ }),
    ).toHaveAttribute('href', '/ajuda/remote-shutdown');
  });

  it('shows an error with a retry when the agent cannot be read', async () => {
    deviceApi().on('GET', '/api/devices/5/agent', {
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Erro interno inesperado.' },
    });
    renderApp('/dispositivos/5');
    const card = await screen.findByRole('region', { name: 'Desligamento remoto' });
    expect(await within(card).findByText('Erro interno inesperado.')).toBeInTheDocument();
  });
});

describe('status signal and IP source (v1.6, FR-503.4)', () => {
  it('shows which signal confirmed "ligada" and where the IP came from', async () => {
    deviceApi({ status: 'online', seenVia: 'agent', ipSource: 'arp' });
    renderApp('/dispositivos/5');
    expect(await screen.findByText('— agente')).toBeInTheDocument();
    expect(screen.getByText('(pela tabela ARP)')).toBeInTheDocument();
  });
});

describe('scheduled-shutdown diagnostics (v1.6, FR-502.1, FR-504.1)', () => {
  it('AC-504-02: shows the next shutdown, the served and current agenda, the last result and each schedule with its reason', async () => {
    deviceApi()
      .on('GET', '/api/devices/5/agent', {
        body: { deviceId: 5, readiness: 'ready', agentVersion: '1.6.0', lastCheckin: at(9) },
      })
      .on('GET', '/api/devices/5/shutdown-diagnostics', {
        body: {
          agenda: {
            servedVersion: '0123456789abcdef',
            servedItems: 0,
            servedAt: at(9),
            currentVersion: 'fedcba9876543210',
            currentItems: 3,
            nextShutdownAt: at(21),
          },
          schedules: [
            { scheduleId: 1, name: 'Desligar Lab 1', reason: 'included', nextAt: at(21) },
            { scheduleId: 2, name: 'Desligar Lab 2', reason: 'not_in_target', nextAt: null },
          ],
          lastShutdown: { at: at(8), result: 'done', path: 'order', detail: null },
        },
      });
    renderApp('/dispositivos/5');
    const card = await screen.findByRole('region', { name: 'Desligamento remoto' });
    const list = await within(card).findByRole('list', { name: 'Agendamentos de desligar' });
    expect(list).toHaveTextContent('Desligar Lab 1: Inclui esta máquina — próximo em');
    expect(list).toHaveTextContent('Desligar Lab 2: O alvo do agendamento não inclui esta máquina');
    expect(card).toHaveTextContent('0 horário(s), versão 01234567');
    expect(card).toHaveTextContent('3 horário(s), versão fedcba98');
    expect(card).toHaveTextContent('por ordem direta');
    expect(card).toHaveTextContent('A máquina ainda não recebeu a agenda atual');
  });
});

describe('"Testar agendamento" (v1.6, FR-504.3)', () => {
  const READY = { deviceId: 5, readiness: 'ready', agentVersion: '1.6.0', lastCheckin: at(9) };
  const diag = (test: unknown) => ({
    agenda: {
      servedVersion: 'fedcba9876543210',
      servedItems: 1,
      servedAt: at(9),
      currentVersion: 'fedcba9876543210',
      currentItems: 1,
      nextShutdownAt: null,
    },
    schedules: [],
    lastShutdown: null,
    test,
  });

  it('AC-504-01: schedules a one-off shutdown in N minutes and shows how it went', async () => {
    const api = deviceApi()
      .on('GET', '/api/devices/5/agent', { body: READY })
      .on('GET', '/api/devices/5/shutdown-diagnostics', { body: diag(null) })
      .on('POST', '/api/devices/5/shutdown-test', { status: 201, body: {} });
    const user = userEvent.setup();
    renderApp('/dispositivos/5');
    const card = await screen.findByRole('region', { name: 'Desligamento remoto' });
    await user.click(await within(card).findByRole('button', { name: 'Testar agendamento' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Testar o desligamento agendado de LAB1-PC05?',
    });
    const field = within(dialog).getByLabelText('Desligar daqui a (minutos)');
    await user.clear(field);
    await user.type(field, '1');
    await user.click(within(dialog).getByRole('button', { name: 'Agendar teste' }));
    expect(await within(dialog).findByText('Escolha de 2 a 60 minutos.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Agendar teste' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.path === '/api/devices/5/shutdown-test')?.body).toEqual({
        minutes: 3,
      }),
    );
  });

  it('shows the latest test with its result and path, and no button without an agent', async () => {
    deviceApi()
      .on('GET', '/api/devices/5/agent', { body: { ...READY, readiness: 'needs_preparation' } })
      .on('GET', '/api/devices/5/shutdown-diagnostics', {
        body: diag({
          uuid: 'b7e1c2d3-0000-4000-8000-000000000001',
          at: at(10),
          warningMinutes: 4,
          createdAt: at(9),
          pushedAt: at(9),
          reconciledAt: at(10),
          result: 'done',
          path: 'agenda',
        }),
      });
    renderApp('/dispositivos/5');
    const card = await screen.findByRole('region', { name: 'Desligamento remoto' });
    expect(await within(card).findByText(/aviso de 4 minutos/)).toHaveTextContent('pela agenda');
    expect(within(card).queryByRole('button', { name: 'Testar agendamento' })).toBeNull();
  });
});

describe('agent health on the device page (v1.6.0, FR-603.5, FR-604)', () => {
  const READY = { deviceId: 5, readiness: 'ready', agentVersion: '1.6.0', lastCheckin: at(9) };

  it('AC-603-05: shows the version vs. this UniWake, the update outcome, the antivirus and what it caught', async () => {
    deviceApi().on('GET', '/api/devices/5/agent', {
      body: {
        ...READY,
        latestVersion: '1.7.0',
        agentAlert: 'blocked',
        health: {
          installLevel: 2,
          update: {
            outcome: 'write_blocked',
            file: 'uniwake-aviso.ps1',
            at: at(8),
            code: 225,
            detail: null,
          },
          repairs: [
            { at: at(7), file: 'uniwake-agent.ps1', reason: 'missing', outcome: 'restored' },
          ],
          antivirus: {
            at: at(8),
            products: [{ name: 'ESET Security', enabled: true, upToDate: false }],
            detections: [
              {
                at: at(6),
                threat: 'Trojan:Teste',
                file: 'uniwake-agent.ps1',
                action: 'quarentena',
              },
            ],
          },
          alert: null,
          receivedAt: at(9),
        },
      },
    });
    renderApp('/dispositivos/5');
    const card = await screen.findByRole('region', { name: 'Desligamento remoto' });
    expect(await within(card).findByText('1.6.0 (a deste UniWake é 1.7.0)')).toBeInTheDocument();
    expect(card).toHaveTextContent('uniwake-aviso.ps1: a gravação foi bloqueada pelo antivírus');
    expect(card).toHaveTextContent('ESET Security (desatualizado)');
    const alert = within(card).getByRole('alert');
    expect(alert).toHaveTextContent(
      'Antivírus pegou uniwake-agent.ps1 (Trojan:Teste) — quarentena',
    );
    expect(alert).toHaveTextContent('uniwake-agent.ps1 sumiu: restaurado da cópia do UniWake');
    expect(
      within(alert).getByRole('link', { name: /Antivírus e o agente do UniWake/ }),
    ).toHaveAttribute('href', '/ajuda/antivirus');
  });

  it('AC-604-02: a "perdido" machine lists the probable causes and its last report', async () => {
    deviceApi().on('GET', '/api/devices/5/agent', {
      body: {
        ...READY,
        readiness: 'lost',
        health: {
          installLevel: 2,
          update: null,
          repairs: [],
          antivirus: null,
          alert: null,
          receivedAt: at(7),
        },
      },
    });
    renderApp('/dispositivos/5');
    const card = await screen.findByRole('region', { name: 'Desligamento remoto' });
    expect(
      await within(card).findByText(/o antivírus bloqueou ou apagou um arquivo do agente/),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent('a tarefa "UniWake" foi desativada ou removida');
    expect(card).toHaveTextContent('Último relatório do agente:');
  });
});
