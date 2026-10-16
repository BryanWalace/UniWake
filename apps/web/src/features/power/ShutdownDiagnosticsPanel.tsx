import { useQuery } from '@tanstack/react-query';
import {
  SHUTDOWN_REASON_LABEL,
  SHUTDOWN_RESULT_LABEL,
  type ShutdownDiagnostics,
} from '@uniwake/shared';
import { api } from '../../api/client';
import { formatDateTime } from '../../lib/format';

const PATH = { agenda: 'pela agenda', order: 'por ordem direta' } as const;

export const useShutdownDiagnostics = (deviceId: number) =>
  useQuery({
    queryKey: ['power', 'diagnostics', deviceId],
    queryFn: () => api.get<ShutdownDiagnostics>(`/api/devices/${deviceId}/shutdown-diagnostics`),
    refetchInterval: 30_000,
  });

/**
 * v1.6 (FR-502.1, FR-504.1): why this machine will or will not shut down on a schedule — what it
 * was last given, what the hub would give now, and each "Desligar" schedule with its reason.
 */
export function ShutdownDiagnosticsPanel({ deviceId }: { deviceId: number }) {
  const q = useShutdownDiagnostics(deviceId);
  if (q.isPending || q.isError) return null; // the card above already shows loading/error
  const { agenda: a, schedules, lastShutdown } = q.data;
  const stale = a.servedVersion !== null && a.servedVersion !== a.currentVersion;
  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 text-sm">
      <h3 className="font-semibold">Desligamento agendado</h3>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Row
          k="Próximo desligamento"
          v={
            a.nextShutdownAt === null
              ? 'nenhum nos próximos 14 dias'
              : formatDateTime(a.nextShutdownAt)
          }
        />
        <Row
          k="Agenda entregue à máquina"
          v={
            a.servedVersion === null
              ? 'nunca'
              : `${a.servedItems ?? 0} horário(s), versão ${a.servedVersion.slice(0, 8)}, ${formatDateTime(a.servedAt)}`
          }
        />
        <Row
          k="Agenda atual no UniWake"
          v={`${a.currentItems} horário(s), versão ${(a.currentVersion ?? '—').slice(0, 8)}`}
        />
        <Row
          k="Último desligamento"
          v={
            lastShutdown === null
              ? 'nenhum relatório ainda'
              : `${SHUTDOWN_RESULT_LABEL[lastShutdown.result]}${lastShutdown.path ? ` ${PATH[lastShutdown.path]}` : ''}, ${formatDateTime(lastShutdown.at)}`
          }
        />
      </dl>
      {stale && (
        <p className="text-amber-900">
          A máquina ainda não recebeu a agenda atual: ela recebe na próxima consulta (até 1 minuto
          depois de ligada).
        </p>
      )}
      {schedules.length === 0 ? (
        <p className="text-slate-700">Nenhum agendamento de desligar existe.</p>
      ) : (
        <ul aria-label="Agendamentos de desligar" className="space-y-1">
          {schedules.map((s) => (
            <li
              key={s.scheduleId}
              className={s.reason === 'included' ? 'text-green-900' : 'text-slate-800'}
            >
              <strong>{s.name}</strong>: {SHUTDOWN_REASON_LABEL[s.reason]}
              {s.nextAt !== null && ` — próximo em ${formatDateTime(s.nextAt)}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1">
      <dt className="text-slate-600">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
