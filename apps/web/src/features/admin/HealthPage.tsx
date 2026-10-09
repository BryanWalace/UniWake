import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { ErrorState, LoadingState } from '../../components/Banner';
import { Button, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { UpdateCard } from './UpdateCard';

interface HealthDetails {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  instanceId?: string;
  startedAt: number;
  uptimeMs: number;
  dbSizeBytes: number | null;
  lastBackupAt: number | null;
  scheduler: {
    lastTickAt: number | null;
    stalled: boolean;
    paused: boolean;
    nextRun: { scheduleName: string; at: number } | null;
  };
  monitor: { lastSweepAt: number | null; durationMs: number | null; stalled: boolean };
  clock: { skewMs: number | null; checkedAt: number | null };
  host: {
    sleepOnAc: boolean | null;
    pendingReboot: boolean | null;
    activeHours: { start: number; end: number } | null;
    checkedAt: number | null;
  };
  warnings: { code: string; severity: 'error' | 'warning'; message: string }[];
}

/** "3 d 4 h", "2 h 05 min", "12 min". */
export function humanDuration(ms: number): string {
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min`;
}

const yesNo = (v: boolean | null, yes: string, no: string) =>
  v === null ? 'não verificado' : v ? yes : no;

const STATUS = {
  ok: { text: 'Tudo funcionando', tone: 'border-green-600 bg-green-50 text-green-900' },
  degraded: { text: 'Com problemas', tone: 'border-red-600 bg-red-50 text-red-900' },
  down: { text: 'Fora do ar', tone: 'border-red-700 bg-red-100 text-red-950' },
} as const;

/** Saúde do sistema (FR-012). */
export function HealthPage() {
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthDetails>('/api/health/details'),
    refetchInterval: 30_000,
  });
  async function recheck() {
    setChecking(true);
    try {
      qc.setQueryData(
        ['health'],
        await api.get<HealthDetails>('/api/health/details', { query: { refresh: 1 } }),
      );
    } finally {
      setChecking(false);
    }
  }
  if (health.isPending) return <LoadingState />;
  if (health.isError)
    return <ErrorState message={health.error.message} onRetry={() => void health.refetch()} />;
  const h = health.data;
  const items: [string, string][] = [
    ['Versão', h.version],
    // ADR-033: identifies this installation (support, Modo equipe).
    ['Identificador desta instalação', h.instanceId ? h.instanceId.slice(0, 8) : '—'],
    ['Em execução há', humanDuration(h.uptimeMs)],
    [
      'Banco de dados',
      h.dbSizeBytes === null ? '—' : `${(h.dbSizeBytes / 1024 / 1024).toFixed(1)} MB`,
    ],
    ['Último backup', h.lastBackupAt === null ? 'nenhum ainda' : formatDateTime(h.lastBackupAt)],
    [
      'Agendador',
      h.scheduler.stalled
        ? 'Agendador parado'
        : `${h.scheduler.paused ? 'pausado' : 'funcionando'} (última verificação ${formatDateTime(h.scheduler.lastTickAt)})`,
    ],
    [
      'Próxima ligação agendada',
      h.scheduler.nextRun
        ? `${h.scheduler.nextRun.scheduleName} — ${formatDateTime(h.scheduler.nextRun.at)}`
        : 'nenhuma',
    ],
    [
      'Verificação de status',
      h.monitor.lastSweepAt === null
        ? 'ainda não rodou'
        : `${formatDateTime(h.monitor.lastSweepAt)}, levou ${Math.round((h.monitor.durationMs ?? 0) / 1000)} s (meta: 30 s)`,
    ],
    [
      'Relógio',
      h.clock.skewMs === null
        ? 'não verificado'
        : Math.abs(h.clock.skewMs) < 60_000
          ? 'certo'
          : `diferença de ${Math.round(Math.abs(h.clock.skewMs) / 60_000)} min`,
    ],
    ['Suspensão na tomada', yesNo(h.host.sleepOnAc, 'pode suspender', 'nunca suspende')],
    ['Reinicialização do Windows pendente', yesNo(h.host.pendingReboot, 'sim', 'não')],
    [
      'Horário ativo do Windows Update',
      h.host.activeHours
        ? `${h.host.activeHours.start}h às ${h.host.activeHours.end}h`
        : 'não verificado',
    ],
  ];
  return (
    <section className="space-y-4">
      <PageHeader
        title="Saúde do sistema"
        actions={
          <Button onClick={() => void recheck()} disabled={checking}>
            {checking ? 'Verificando…' : 'Verificar de novo'}
          </Button>
        }
      />
      <p
        role="status"
        className={`rounded-lg border-l-4 p-3 text-lg font-bold ${STATUS[h.status].tone}`}
      >
        {STATUS[h.status].text}
      </p>
      {h.warnings.length > 0 && (
        <ul className="space-y-2" aria-label="Avisos">
          {h.warnings.map((w) => (
            <li
              key={w.code}
              className={`rounded-md border p-3 text-sm ${
                w.severity === 'error'
                  ? 'border-red-300 bg-red-50 text-red-900'
                  : 'border-amber-300 bg-amber-50 text-amber-950'
              }`}
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[max-content_1fr]">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-sm font-medium text-slate-600">{k}</dt>
            <dd className={`text-sm ${v === 'Agendador parado' ? 'font-bold text-red-800' : ''}`}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <UpdateCard />
    </section>
  );
}
