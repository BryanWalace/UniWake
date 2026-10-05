import { useState } from 'react';
import { Link } from 'react-router';
import { RUN_STATUS_LABEL } from '@uniwake/shared';
import { ErrorState, LoadingState } from '../../components/Banner';
import { Button, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useScheduleRuns } from './api';

const TONE: Record<string, string> = {
  executado: 'text-green-800',
  atrasado: 'text-amber-800',
  falhou: 'text-red-800',
  perdido: 'text-red-800',
};

/** Execution log of the schedules (FR-005.7). */
export function RunsSection() {
  const [page, setPage] = useState(1);
  const runs = useScheduleRuns({ page });
  return (
    <section className="mt-8">
      <PageHeader level={2} title="Execuções dos agendamentos" />
      {runs.isPending ? (
        <LoadingState />
      ) : runs.isError ? (
        <ErrorState message={runs.error.message} onRetry={() => void runs.refetch()} />
      ) : runs.data.total === 0 ? (
        <p className="text-sm text-slate-700">Nenhuma execução ainda.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Execuções dos agendamentos</caption>
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Planejado
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Agendamento
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Situação
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Detalhe
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Ligação
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.data.items.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{formatDateTime(r.plannedAt)}</td>
                    <td className="px-3 py-2">{r.scheduleName}</td>
                    <td className={`px-3 py-2 font-semibold ${TONE[r.status] ?? ''}`}>
                      {RUN_STATUS_LABEL[r.status]}
                    </td>
                    <td className="px-3 py-2">{r.detail ?? '—'}</td>
                    <td className="px-3 py-2">
                      {r.jobId !== null ? (
                        <Link to={`/historico/jobs/${r.jobId}`} className="text-blue-800 underline">
                          #{r.jobId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center gap-3 text-sm">
            <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Anteriores
            </Button>
            <span>
              Página {page} de {Math.max(1, Math.ceil(runs.data.total / runs.data.pageSize))}
            </span>
            <Button
              disabled={page * runs.data.pageSize >= runs.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Seguintes
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
