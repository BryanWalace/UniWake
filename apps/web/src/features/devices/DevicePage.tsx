import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  DEVICE_RESULT_LABEL,
  type Device,
  type DeviceDiagnostics,
  type DeviceHistoryItem,
  type DeviceHistoryPage,
  TEST_WOL_STATE_LABEL,
} from '@uniwake/shared';
import { api, ApiRequestError } from '../../api/client';
import { useDevice, useRooms, useTags } from '../../api/hooks';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { Button, PageHeader, SelectField, StatusBadge, TagChip } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useUptime } from '../dashboard/api';
import { useWakeUi } from '../wake/WakeProvider';
import { DeviceFormDialog } from './DeviceFormDialog';
import { HelpLink } from '../help/HelpPage';
import { TestWolDialog } from './TestWolDialog';
import { noticeFromSave, SaveNotice } from './DevicesPage';

const SOURCE_TEXT = { manual: 'manual', schedule: 'agendamento', test: 'teste' } as const;
const STATUS_TEXT = {
  online: 'Ficou ligada',
  offline: 'Ficou desligada',
  desconhecido: 'Status desconhecido',
};

export function historyText(i: DeviceHistoryItem): string {
  switch (i.kind) {
    case 'status':
      return i.reason === 'hub_start'
        ? 'Status desconhecido (o UniWake foi reiniciado)'
        : STATUS_TEXT[i.to];
    case 'ip_changed':
      return `IP mudou de ${i.from ?? '(sem IP)'} para ${i.to}`;
    case 'moved':
      return 'Mudou de sala';
    case 'enrolled':
      return 'Cadastrada pelo agente';
    case 'wake':
      return `Ligar (${SOURCE_TEXT[i.source]}${i.dryRun ? ', simulação' : ''}): ${DEVICE_RESULT_LABEL[i.result].toLowerCase()}`;
  }
}

const pct = (r: number | null) =>
  r === null ? '—' : `${(Math.round(r * 1000) / 10).toLocaleString('pt-BR')}%`;

/** Device detail `/dispositivos/:id`: status, data, uptime, history (FR-004.6). */
export function DevicePage() {
  const id = Number(useParams().id);
  const device = useDevice(id);
  const { requestWake } = useWakeUi();
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null);

  if (device.isPending) return <LoadingState />;
  if (device.isError) {
    if (device.error instanceof ApiRequestError && device.error.status === 404) {
      return (
        <EmptyState title="Máquina não encontrada">
          <Link to="/dispositivos" className="text-blue-800 underline">
            Ver todas as máquinas
          </Link>
        </EmptyState>
      );
    }
    return <ErrorState message={device.error.message} onRetry={() => void device.refetch()} />;
  }
  const d = device.data;
  return (
    <section className="space-y-6">
      <nav aria-label="Trilha" className="text-sm">
        <Link to="/dispositivos" className="text-blue-800 underline">
          Dispositivos
        </Link>{' '}
        / {d.name}
      </nav>
      <PageHeader
        title={d.name}
        actions={
          <>
            <Button
              variant="primary"
              disabled={!d.enabled}
              onClick={() =>
                requestWake({
                  title: `Ligar ${d.name}`,
                  target: { type: 'devices', deviceIds: [d.id] },
                })
              }
            >
              Ligar
            </Button>
            <Button disabled={!d.enabled} onClick={() => setTesting(true)}>
              Testar WoL
            </Button>
            <Button onClick={() => setEditing(true)}>Editar</Button>
          </>
        }
      />
      <SaveNotice notice={notice} onDismiss={() => setNotice(null)} />
      <Details device={d} />
      <Uptime deviceId={d.id} />
      <History deviceId={d.id} />
      <Diagnostics device={d} />
      <TestWolDialog
        deviceId={d.id}
        deviceName={d.name}
        open={testing}
        onClose={() => setTesting(false)}
      />
      <DeviceFormDialog
        open={editing}
        device={d}
        onClose={() => setEditing(false)}
        onSaved={(r) => {
          setEditing(false);
          setNotice(noticeFromSave(r, false));
        }}
      />
    </section>
  );
}

function Details({ device: d }: { device: Device }) {
  const rooms = useRooms();
  const tags = useTags();
  const room = rooms.data?.find((r) => r.id === d.roomId);
  const rows: [string, React.ReactNode][] = [
    ['Status', <StatusBadge key="s" status={d.status} />],
    ['Latência', d.latencyMs === null ? '—' : `${d.latencyMs} ms`],
    ['Visto pela última vez', formatDateTime(d.lastSeenAt)],
    ['Ligada desde', formatDateTime(d.onlineSince)],
    [
      'IP',
      <span key="ip" className="font-mono">
        {d.ip ?? 'sem IP'}
      </span>,
    ],
    ['Hostname', d.hostname ?? '—'],
    [
      'MAC',
      <span key="mac" className="font-mono">
        {d.mac}
      </span>,
    ],
    [
      'Sala',
      d.roomId === null ? (
        'Sem sala'
      ) : (
        <Link key="room" to={`/salas/${d.roomId}`} className="text-blue-800 underline">
          {room?.name ?? `Sala ${d.roomId}`}
        </Link>
      ),
    ],
    [
      'Etiquetas',
      d.tagIds.length === 0 ? (
        '—'
      ) : (
        <span key="tags" className="flex flex-wrap gap-1">
          {d.tagIds.map((tid) => {
            const t = tags.data?.find((x) => x.id === tid);
            return t ? <TagChip key={tid} name={t.name} color={t.color} /> : null;
          })}
        </span>
      ),
    ],
    ['Situação', d.enabled ? 'Ativa' : 'Desativada (não é ligada nem verificada)'],
  ];
  if (d.notes) rows.push(['Observações', d.notes]);
  return (
    <section aria-labelledby="dados" className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 id="dados" className="mb-3 text-lg font-bold">
        Dados
      </h2>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-sm font-medium text-slate-600">{k}</dt>
            <dd className="text-sm">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Uptime({ deviceId }: { deviceId: number }) {
  const [days, setDays] = useState(7);
  const uptime = useUptime({ deviceId, days });
  return (
    <section
      aria-labelledby="disponibilidade"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id="disponibilidade" className="text-lg font-bold">
          Disponibilidade
        </h2>
        <SelectField
          label="Período"
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
        </SelectField>
      </div>
      {uptime.isPending ? (
        <LoadingState />
      ) : uptime.isError ? (
        <ErrorState message={uptime.error.message} onRetry={() => void uptime.refetch()} />
      ) : (
        <>
          <p className="mb-2 text-sm">
            Média do período: <strong>{pct(uptime.data.average)}</strong> do dia ligada.
          </p>
          <ol aria-label="Disponibilidade por dia" className="space-y-1">
            {[...uptime.data.days].reverse().map((x) => (
              <li key={x.day} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 font-mono">
                  {x.day.split('-').reverse().join('/')}
                </span>
                <span className="h-3 flex-1 rounded bg-slate-200" aria-hidden="true">
                  <span
                    className="block h-3 rounded bg-green-600"
                    style={{ width: `${Math.round((x.ratio ?? 0) * 100)}%` }}
                  />
                </span>
                <span className="w-16 text-right">{pct(x.ratio)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function History({ deviceId }: { deviceId: number }) {
  const history = useInfiniteQuery({
    queryKey: ['devices', 'one', deviceId, 'history'],
    queryFn: ({ pageParam }) =>
      api.get<DeviceHistoryPage>(`/api/devices/${deviceId}/history`, {
        query: { limit: 50, before: pageParam ?? undefined },
      }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
  });
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section
      aria-labelledby="historico"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="historico" className="mb-3 text-lg font-bold">
        Histórico
      </h2>
      {history.isPending ? (
        <LoadingState />
      ) : history.isError ? (
        <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-600">Nada registrado ainda.</p>
      ) : (
        <>
          <ol className="divide-y divide-slate-100">
            {items.map((i, n) => (
              <li key={`${i.kind}-${i.at}-${n}`} className="flex flex-wrap gap-x-4 py-1.5 text-sm">
                <span className="w-40 shrink-0 text-slate-600">{formatDateTime(i.at)}</span>
                <span>
                  {historyText(i)}
                  {i.kind === 'wake' && (
                    <>
                      {' '}
                      <Link to={`/historico/jobs/${i.jobId}`} className="text-blue-800 underline">
                        ver ligação
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {history.hasNextPage && (
            <Button
              className="mt-3"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              Carregar mais
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/** Full diagnostics arrive with FR-010 (M7); the "nunca respondeu" hint is AC-004-12. */
function Diagnostics({ device: d }: { device: Device }) {
  const q = useQuery({
    queryKey: ['diagnostics', d.id] as const,
    queryFn: () => api.get<DeviceDiagnostics>(`/api/devices/${d.id}/diagnostics`),
  });
  return (
    <section
      id="diagnostico"
      aria-labelledby="diagnostico-titulo"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="diagnostico-titulo" className="text-lg font-bold">
        Diagnóstico
      </h2>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : (
        <DiagnosticsBody diag={q.data} />
      )}
    </section>
  );
}

const percent = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

function DiagnosticsBody({ diag }: { diag: DeviceDiagnostics }) {
  const { wake, network: net, lastTestWol: test, prepare } = diag;
  return (
    <>
      {diag.problems.length === 0 ? (
        <p className="text-sm text-slate-700">Nenhum problema detectado.</p>
      ) : (
        <ul className="space-y-2" aria-label="Problemas encontrados">
          {diag.problems.map((p) => (
            <li
              key={p.code}
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            >
              <p className="font-semibold">{p.title}</p>
              <p>{p.message}</p>
              {p.help && (
                <p className="mt-1">
                  <HelpLink topic={p.help} />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <DiagItem label="Última vez que ligou pela rede">
          {wake.lastSuccessAt !== null ? formatDateTime(wake.lastSuccessAt) : 'nunca'}
        </DiagItem>
        <DiagItem label="Taxa de sucesso (últimas tentativas)">
          {percent(wake.successRate)} ({wake.successes} de {wake.attempts})
        </DiagItem>
        <DiagItem label="Último teste de WoL">
          {test
            ? `${TEST_WOL_STATE_LABEL[test.state]} em ${formatDateTime(test.finishedAt ?? test.startedAt)}`
            : 'nunca testado'}
        </DiagItem>
        <DiagItem label="Preparada em">
          {prepare.preparedAt !== null ? formatDateTime(prepare.preparedAt) : 'não preparada'}
        </DiagItem>
        <DiagItem label="Outros MACs informados">
          {diag.otherMacs.length > 0 ? diag.otherMacs.join(', ') : '—'}
        </DiagItem>
        <DiagItem label="Mesma rede do UniWake">
          {net.sameSubnet === null ? '—' : net.sameSubnet ? 'sim' : 'não'}
        </DiagItem>
      </dl>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Para onde o Magic Packet vai</summary>
        <ul className="mt-2 space-y-1">
          {net.destinations.map((x) => (
            <li key={`${x.sourceIp}>${x.destination}`}>
              de {x.sourceIp} para {x.destination}
            </li>
          ))}
        </ul>
      </details>
      {prepare.results && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Resultado da preparação</summary>
          <ul className="mt-2 space-y-1">
            {Object.entries(prepare.results).map(([step, result]) => (
              <li key={step}>
                {step}: {result}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-sm">
        Confira também a <HelpLink topic="bios-erp">BIOS/UEFI</HelpLink> (Wake on LAN ativado, ErP
        desativado).
      </p>
    </>
  );
}

function DiagItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
