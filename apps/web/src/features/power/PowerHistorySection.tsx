import {
  EXCLUDED_REASON_LABEL,
  type PowerJob,
  type PowerOccurrence,
  type PowerOccurrenceDevice,
  SHUTDOWN_RESULT_LABEL,
} from '@uniwake/shared';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { formatDateTime, plural } from '../../lib/format';
import { usePowerHistory } from './api';
import { usePowerUi } from './PowerProvider';

const ACTION_LABEL = { shutdown: 'Desligar', restart: 'Reiniciar' } as const;
const PATH_LABEL = { agenda: 'pela agenda', order: 'por ordem direta' } as const;

/** "28/30 desligaram, 1 adiou 2×, 1 estava desligada" (FR-307), plus the v1.6 reconciliation. */
export function occurrenceSummary(o: PowerOccurrence): string {
  const c = o.counts;
  const n = (k: number, one: string, many: string) => (k > 0 ? [plural(k, one, many)] : []);
  // FR-601.2: excluded machines are not part of the "x/y desligaram" the schedule aimed at.
  const reached = o.devices.length - c.excluded;
  return [
    `${c.done}/${reached} ${c.done === 1 ? 'desligou' : 'desligaram'}`,
    ...(c.postponed > 0
      ? [`${c.postponed} ${c.postponed === 1 ? 'adiou' : 'adiaram'} até ${o.maxPostpones}×`]
      : []),
    ...n(
      c.probably_done,
      'provavelmente desligou (sem relatório)',
      'provavelmente desligaram (sem relatório)',
    ),
    ...n(c.off_no_report, 'desligou (relatório a caminho)', 'desligaram (relatório a caminho)'),
    ...n(c.was_off, 'estava desligada', 'estavam desligadas'),
    ...n(c.late_wake, 'acordou atrasada (pulado)', 'acordaram atrasadas (pulado)'),
    ...n(c.postponed_active, 'adiado — usuário ativo', 'adiados — usuário ativo'),
    ...n(c.still_on, 'ainda ligado', 'ainda ligados'),
    ...n(c.no_agent, 'sem agente', 'sem agente'),
    ...n(c.stale_agenda, 'agenda desatualizada', 'agendas desatualizadas'),
    ...n(c.no_answer, 'sem resposta', 'sem resposta'),
    ...n(c.cancelled, 'cancelado', 'cancelados'),
    ...n(c.failed, 'falhou', 'falharam'),
    ...n(c.no_report, 'sem relatório', 'sem relatório'),
    ...n(c.excluded, 'excluída do agendamento', 'excluídas do agendamento'),
  ].join(', ');
}

function deviceDetail(d: PowerOccurrenceDevice): string {
  const parts = [SHUTDOWN_RESULT_LABEL[d.result]];
  if (d.result === 'late_wake' && d.lateMinutes !== null) {
    parts[0] = `Pulado: acordou ${d.lateMinutes} min após o horário`;
  }
  if (d.result === 'done' && d.path) parts[0] = `${parts[0]} ${PATH_LABEL[d.path]}`;
  if (d.result === 'excluded' && d.excludedReason) {
    parts[0] = `${parts[0]} (${EXCLUDED_REASON_LABEL[d.excludedReason]})`;
  }
  if (d.postpones > 0) parts.push(`adiou ${d.postpones}×`);
  if (d.wasAsleep) parts.push('estava em suspensão');
  if (d.nativeWarning) parts.push('aviso do Windows');
  if (d.userLoggedOn) parts.push('havia usuário logado');
  return parts.join(' · ');
}

/** Shutdowns and restarts next to the wakes (FR-307): scheduled occurrences and manual jobs. */
export function PowerHistorySection() {
  const q = usePowerHistory();
  return (
    <section aria-labelledby="desligamentos" className="mt-8">
      <h2 id="desligamentos" className="mb-3 text-lg font-bold">
        Desligamentos e reinícios
      </h2>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : q.data.occurrences.length === 0 && q.data.jobs.length === 0 ? (
        <EmptyState title="Nenhum desligamento ainda">
          Os desligamentos agendados e os pedidos pelo painel aparecem aqui. Relatórios de máquinas
          que desligaram com o UniWake fechado chegam na próxima consulta delas.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {q.data.occurrences.length > 0 && <Occurrences items={q.data.occurrences} />}
          {q.data.jobs.length > 0 && <Jobs items={q.data.jobs} />}
        </div>
      )}
    </section>
  );
}

function Occurrences({ items }: { items: PowerOccurrence[] }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold">Agendados</h3>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {items.map((o) => (
          <li key={o.occurrence} className="px-3 py-2 text-sm">
            <details>
              <summary className="cursor-pointer">
                <span className="font-medium">
                  {o.plannedAt === null
                    ? 'Desligamento'
                    : `Desligamento ${formatDateTime(o.plannedAt)}`}
                  {' — '}
                  {o.scheduleName ?? 'agendamento excluído'}
                </span>
                <span className="block text-slate-700">{occurrenceSummary(o)}</span>
              </summary>
              <ul className="mt-2 space-y-0.5 pl-4">
                {o.devices.map((d) => (
                  <li key={d.deviceId}>
                    <span className="font-medium">{d.name}</span>: {deviceDetail(d)}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Jobs({ items }: { items: PowerJob[] }) {
  const { showPowerJob } = usePowerUi();
  return (
    <div>
      <h3 className="mb-2 font-semibold">Pedidos pelo painel</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Desligamentos e reinícios pedidos pelo painel</caption>
          <thead className="bg-slate-50 text-left">
            <tr>
              <th scope="col" className="px-3 py-2">
                Quando
              </th>
              <th scope="col" className="px-3 py-2">
                Ação
              </th>
              <th scope="col" className="px-3 py-2">
                Alvo
              </th>
              <th scope="col" className="px-3 py-2">
                Pedido por
              </th>
              <th scope="col" className="px-3 py-2">
                Concluídas
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((j) => (
              <tr key={j.id}>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-blue-800 underline"
                    onClick={() => showPowerJob(j.id)}
                  >
                    {formatDateTime(j.createdAt)}
                  </button>
                </td>
                <td className="px-3 py-2">{ACTION_LABEL[j.action]}</td>
                <td className="px-3 py-2">{j.label}</td>
                <td className="px-3 py-2">{j.createdBy ?? '—'}</td>
                <td className="px-3 py-2">
                  {j.counts.done}/{j.devices.length}
                  {j.counts.not_confirmed > 0 && ` · ${j.counts.not_confirmed} não confirmaram`}
                  {j.counts.expired > 0 && ` · ${j.counts.expired} expiraram`}
                  {j.counts.was_off > 0 && ` · ${j.counts.was_off} estavam desligadas`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
