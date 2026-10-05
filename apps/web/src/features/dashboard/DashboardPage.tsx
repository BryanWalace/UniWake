import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type {
  DashboardNotice,
  DashboardRoom,
  DeviceStatus,
  RoomLastAction,
  StatusCounts,
} from '@uniwake/shared';
import { useDevices, useRooms } from '../../api/hooks';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { Button, PageHeader, SelectField, StatusBadge } from '../../components/ui';
import { formatDateTime, formatTime, plural, useNow } from '../../lib/format';
import { useDebounced } from '../devices/DevicesPage';
import { useRealtimeState } from '../../realtime/RealtimeProvider';
import { useWakeUi } from '../wake/WakeProvider';
import { useDashboard } from './api';
import { MorningResultCard } from './MorningResultCard';

const STATUS_FILTERS: { value: DeviceStatus; label: string }[] = [
  { value: 'online', label: 'Ligadas' },
  { value: 'offline', label: 'Desligadas' },
  { value: 'desconhecido', label: 'Desconhecidas' },
];

const SOURCE_TEXT: Record<RoomLastAction['source'], string> = {
  manual: 'manualmente',
  schedule: 'por agendamento',
  test: 'em teste',
};

const NOTICE_TEXT: Record<string, (data: Record<string, unknown>) => string> = {
  demo: () => 'Modo demonstração: nenhum pacote real é enviado.',
  lan_error: (data) =>
    `O acesso ao painel pela rede está ligado, mas não iniciou: ${typeof data.message === 'string' ? data.message : 'erro desconhecido.'} Corrija em Configurações e reinicie o serviço.`,
};

/** "Ligada às 06:50 por agendamento — 28/30 acordaram" (FR-004.5). */
export function lastActionText(a: RoomLastAction, now: number): string {
  const sameDay = new Date(a.at).toDateString() === new Date(now).toDateString();
  const when = sameDay ? `às ${formatTime(a.at).slice(0, 5)}` : `em ${formatDateTime(a.at)}`;
  const running = a.state === 'pendente' || a.state === 'enviando' || a.state === 'verificando';
  const head = running
    ? `Ligando ${when} ${SOURCE_TEXT[a.source]}`
    : `Ligada ${when} ${SOURCE_TEXT[a.source]}`;
  const parts = [`${a.woke}/${a.total} acordaram`];
  if (a.alreadyOn > 0) parts.push(plural(a.alreadyOn, 'já estava ligada', 'já estavam ligadas'));
  if (a.sendFailed > 0) parts.push(plural(a.sendFailed, 'falha no envio', 'falhas no envio'));
  return `${head} — ${parts.join(', ')}${a.dryRun ? ' (simulação)' : ''}`;
}

/** Painel (FR-004.5): counters, room cards, search, tag and status filters, notices. */
export function DashboardPage() {
  const dash = useDashboard();
  const { requestWake } = useWakeUi();
  const now = useNow(30_000);
  const live = useRealtimeState();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DeviceStatus | ''>('');
  const [tagId, setTagId] = useState<number | ''>('');
  const q = useDebounced(search.trim(), 250);

  // "/" focuses the search unless the user is typing somewhere (FR-004.5).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (dash.isPending) return <LoadingState />;
  if (dash.isError) {
    return <ErrorState message={dash.error.message} onRetry={() => void dash.refetch()} />;
  }
  const d = dash.data;
  const filtering = q !== '' || status !== '' || tagId !== '';
  const tag = d.tags.find((t) => t.id === tagId);

  return (
    <section className="space-y-6">
      <PageHeader title="Painel" />
      <p className="-mt-3 text-sm text-slate-600">
        {d.lastSweepAt === null
          ? 'Aguardando a primeira verificação de status…'
          : `Status verificado às ${formatTime(d.lastSweepAt)}.`}{' '}
        {live === 'open' ? (
          <span className="font-medium text-green-800">Atualização ao vivo.</span>
        ) : live === 'connecting' ? (
          <span className="font-medium text-amber-800">Reconectando atualizações ao vivo…</span>
        ) : null}
      </p>

      <p className="-mt-4 text-sm text-slate-600">
        Dica: <kbd className="rounded border border-slate-300 px-1">Ctrl</kbd>+
        <kbd className="rounded border border-slate-300 px-1">K</kbd> liga qualquer sala, etiqueta
        ou máquina de qualquer página.
      </p>

      <Notices notices={d.notices} />

      <Counters
        counts={d.counters}
        active={status}
        onPick={(s) => setStatus((cur) => (cur === s ? '' : s))}
      />

      <div className="flex flex-wrap items-end gap-3" role="search">
        <label className="flex min-w-64 flex-1 flex-col text-sm font-medium">
          Buscar máquina
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome, IP, MAC ou hostname (atalho: /)"
            maxLength={100}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as DeviceStatus | '')}
        >
          <option value="">Todos</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Etiqueta"
          value={tagId === '' ? '' : String(tagId)}
          onChange={(e) => setTagId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Todas</option>
          {d.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.total})
            </option>
          ))}
        </SelectField>
        {tag && (
          <Button
            variant="primary"
            disabled={tag.total === 0}
            onClick={() =>
              requestWake({
                title: `Ligar dispositivos com a etiqueta ${tag.name}`,
                target: { type: 'tags', tagIds: [tag.id] },
              })
            }
          >
            Ligar dispositivos com esta tag
          </Button>
        )}
      </div>

      {filtering ? (
        <DeviceResults
          q={q}
          status={status === '' ? undefined : status}
          tagId={tagId === '' ? undefined : tagId}
        />
      ) : d.rooms.length === 0 && d.noRoom === null ? (
        <EmptyState title="Nenhuma máquina cadastrada ainda">
          <Link to="/dispositivos" className="text-blue-800 underline">
            Cadastre máquinas
          </Link>{' '}
          ou{' '}
          <Link to="/dispositivos/importar" className="text-blue-800 underline">
            importe uma planilha CSV
          </Link>
          .
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Salas">
          {d.rooms.map((r) => (
            <RoomCard key={r.id} room={r} now={now} />
          ))}
          {d.noRoom && <NoRoomCard counts={d.noRoom} />}
        </ul>
      )}
    </section>
  );
}

function Notices({ notices }: { notices: DashboardNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <section aria-label="Avisos" className="space-y-2">
      {notices.map((n) =>
        n.type === 'morning_result' ? (
          <MorningResultCard key={n.id} notice={n} />
        ) : (
          <p
            key={n.id}
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          >
            {NOTICE_TEXT[n.type]?.(n.data) ?? 'Aviso do sistema.'}{' '}
            <span className="text-amber-800">({formatDateTime(n.createdAt)})</span>
          </p>
        ),
      )}
    </section>
  );
}

function Counters({
  counts,
  active,
  onPick,
}: {
  counts: StatusCounts;
  active: DeviceStatus | '';
  onPick: (s: DeviceStatus) => void;
}) {
  const items: { status: DeviceStatus; label: string; n: number; tone: string }[] = [
    { status: 'online', label: 'Ligadas', n: counts.online, tone: 'border-green-600' },
    { status: 'offline', label: 'Desligadas', n: counts.offline, tone: 'border-slate-500' },
    {
      status: 'desconhecido',
      label: 'Desconhecidas',
      n: counts.desconhecido,
      tone: 'border-amber-500',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Contadores">
      {items.map((i) => (
        <button
          key={i.status}
          type="button"
          aria-pressed={active === i.status}
          onClick={() => onPick(i.status)}
          className={`rounded-lg border-l-4 bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 ${i.tone} ${
            active === i.status ? 'ring-2 ring-blue-600' : ''
          }`}
        >
          <span className="block text-2xl font-bold">{i.n}</span>
          <span className="text-sm text-slate-700">{i.label}</span>
        </button>
      ))}
      <div className="rounded-lg border-l-4 border-blue-700 bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <span className="block text-2xl font-bold">{counts.total}</span>
        <span className="text-sm text-slate-700">Total</span>
      </div>
    </div>
  );
}

function OnlineBar({ counts }: { counts: StatusCounts }) {
  const pct = counts.total === 0 ? 0 : Math.round((counts.online / counts.total) * 100);
  return (
    <div>
      <p className="text-lg font-semibold">
        {counts.online}/{counts.total}{' '}
        <span className="text-sm font-normal text-slate-600">ligadas</span>
      </p>
      <div
        className="mt-1 h-2 rounded bg-slate-200"
        role="meter"
        aria-label="Máquinas ligadas"
        aria-valuemin={0}
        aria-valuemax={counts.total}
        aria-valuenow={counts.online}
      >
        <div className="h-2 rounded bg-green-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RoomCard({ room, now }: { room: DashboardRoom; now: number }) {
  const { requestWake } = useWakeUi();
  const target = { type: 'rooms' as const, roomIds: [room.id], includeNoRoom: false };
  const where = [room.block, room.floor].filter(Boolean).join(' · ');
  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div aria-hidden="true" className="h-1.5" style={{ backgroundColor: room.color }} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h2 className="text-lg font-bold">{room.name}</h2>
          {where && <p className="text-sm text-slate-600">{where}</p>}
        </div>
        <OnlineBar counts={room.counts} />
        <p className="text-sm text-slate-700">
          {room.lastAction ? lastActionText(room.lastAction, now) : 'Nenhuma ação recente.'}
        </p>
        <div className="mt-auto flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={room.counts.total === 0}
            onClick={() => requestWake({ title: `Ligar sala ${room.name}`, target })}
          >
            Ligar sala
          </Button>
          <Button
            disabled={room.counts.total === 0}
            aria-label={`Ligar só os desligados — ${room.name}`}
            onClick={() =>
              requestWake({
                title: `Ligar só os desligados — ${room.name}`,
                target,
                onlyOffline: true,
              })
            }
          >
            Ligar só os desligados
          </Button>
          <Link
            to={`/salas/${room.id}`}
            className="rounded-md px-3 py-2 text-sm font-medium text-blue-800 underline"
            aria-label={`Ver máquinas — ${room.name}`}
          >
            Ver máquinas
          </Link>
        </div>
      </div>
    </li>
  );
}

function NoRoomCard({ counts }: { counts: StatusCounts }) {
  const { requestWake } = useWakeUi();
  const target = { type: 'rooms' as const, roomIds: [], includeNoRoom: true };
  return (
    <li className="flex flex-col rounded-lg border border-dashed border-slate-300 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold">Sem sala</h2>
      <p className="mb-3 text-sm text-slate-600">
        Máquinas que ainda não foram colocadas em uma sala.
      </p>
      <OnlineBar counts={counts} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => requestWake({ title: 'Ligar máquinas sem sala', target })}
        >
          Ligar sala
        </Button>
        <Button
          aria-label="Ligar só os desligados — Sem sala"
          onClick={() =>
            requestWake({ title: 'Ligar só os desligados — Sem sala', target, onlyOffline: true })
          }
        >
          Ligar só os desligados
        </Button>
        <Link
          to="/dispositivos?sala=none"
          className="rounded-md px-3 py-2 text-sm font-medium text-blue-800 underline"
          aria-label="Ver máquinas — Sem sala"
        >
          Ver máquinas
        </Link>
      </div>
    </li>
  );
}

function DeviceResults({ q, status, tagId }: { q: string; status?: DeviceStatus; tagId?: number }) {
  const devices = useDevices({ q, status, tagId, page: 1, pageSize: 50 });
  const rooms = useRooms();
  const roomName = new Map((rooms.data ?? []).map((r) => [r.id, r.name]));
  if (devices.isPending) return <LoadingState />;
  if (devices.isError) {
    return <ErrorState message={devices.error.message} onRetry={() => void devices.refetch()} />;
  }
  const { items, total } = devices.data;
  return (
    <section aria-label="Resultados da busca">
      <p role="status" className="mb-2 text-sm text-slate-700">
        {total === 0
          ? 'Nenhuma máquina encontrada.'
          : `${plural(total, 'máquina encontrada', 'máquinas encontradas')}${
              total > items.length ? ` (mostrando ${items.length})` : ''
            }.`}
      </p>
      {items.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {items.map((dv) => (
            <li key={dv.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
              <Link
                to={`/dispositivos/${dv.id}`}
                className="min-w-40 font-semibold text-blue-800 underline"
              >
                {dv.name}
              </Link>
              <StatusBadge status={dv.status} />
              <span className="font-mono text-slate-700">{dv.ip ?? 'sem IP'}</span>
              <span className="text-slate-600">
                {dv.roomId === null ? 'Sem sala' : (roomName.get(dv.roomId) ?? '')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
