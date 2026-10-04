import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DEVICE_RESULT_LABEL, JOB_STATE_LABEL } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { Button, PageHeader } from '../../components/ui';
import { formatDateTime, formatTime, useNow } from '../../lib/format';
import { useJob, useJobPackets, useJobs } from './api';
import { JobProgress } from './JobDrawer';

const SOURCE_LABEL = { manual: 'Manual', schedule: 'Agendamento', test: 'Teste' } as const;

/** Wake history (FR-009): every job, newest first. */
export function HistoryPage() {
  const [page, setPage] = useState(1);
  const jobs = useJobs(page);
  return (
    <section>
      <PageHeader title="Histórico de ligações" />
      {jobs.isPending ? (
        <LoadingState />
      ) : jobs.isError ? (
        <ErrorState message={jobs.error.message} onRetry={() => void jobs.refetch()} />
      ) : jobs.data.total === 0 ? (
        <EmptyState title="Nenhuma ligação ainda">
          As ligações manuais e agendadas aparecem aqui.
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Ligações</caption>
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Quando
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Alvo
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Origem
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Acordaram
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Não responderam
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.data.items.map((j) => (
                  <tr key={j.id}>
                    <td className="px-3 py-2">
                      <Link to={`/historico/jobs/${j.id}`} className="text-blue-800 underline">
                        {formatDateTime(j.createdAt)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {j.targetLabel}
                      {j.dryRun && <span className="ml-1 text-xs text-amber-800">(simulação)</span>}
                    </td>
                    <td className="px-3 py-2">
                      {SOURCE_LABEL[j.source]}
                      {j.requestedBy ? ` · ${j.requestedBy}` : ''}
                    </td>
                    <td className="px-3 py-2">{JOB_STATE_LABEL[j.state]}</td>
                    <td className="px-3 py-2">
                      {j.summary.woke + j.summary.alreadyOn}/{j.summary.total}
                    </td>
                    <td className="px-3 py-2">{j.summary.noResponse + j.summary.sendFailed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Paginação" className="mt-3 flex justify-end gap-2">
            <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <Button disabled={page * 50 >= jobs.data.total} onClick={() => setPage((p) => p + 1)}>
              Próxima
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}

/** One job: progress, per-device results and the packet log (FR-003.6). */
export function JobPage() {
  const id = Number(useParams().id);
  const q = useJob(id);
  const now = useNow();
  const [showPackets, setShowPackets] = useState(false);
  const packets = useJobPackets(id, showPackets);
  if (q.isPending) return <LoadingState />;
  if (q.isError) {
    if (q.error instanceof ApiRequestError && q.error.status === 404)
      return <EmptyState title="Ligação não encontrada" />;
    return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  }
  return (
    <section className="space-y-5">
      <nav aria-label="Trilha" className="text-sm">
        <Link to="/historico" className="text-blue-800 underline">
          Histórico
        </Link>{' '}
        / Ligação #{id}
      </nav>
      <PageHeader title={`Ligação #${id} — ${formatDateTime(q.data.job.createdAt)}`} />
      <JobProgress detail={q.data} now={now} />
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Resultado por máquina</caption>
          <thead className="bg-slate-50 text-left">
            <tr>
              <th scope="col" className="px-3 py-2">
                Máquina
              </th>
              <th scope="col" className="px-3 py-2">
                MAC
              </th>
              <th scope="col" className="px-3 py-2">
                Resultado
              </th>
              <th scope="col" className="px-3 py-2">
                Enviado
              </th>
              <th scope="col" className="px-3 py-2">
                Acordou
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.devices.map((d) => (
              <tr key={d.deviceId}>
                <td className="px-3 py-2">{d.name}</td>
                <td className="px-3 py-2 font-mono">{d.mac}</td>
                <td className="px-3 py-2">{DEVICE_RESULT_LABEL[d.result]}</td>
                <td className="px-3 py-2">{formatTime(d.sentAt)}</td>
                <td className="px-3 py-2">{formatTime(d.wokeAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button onClick={() => setShowPackets((v) => !v)} aria-expanded={showPackets}>
          {showPackets ? 'Ocultar pacotes enviados' : 'Mostrar pacotes enviados'}
        </Button>
        {showPackets &&
          (packets.isPending ? (
            <LoadingState />
          ) : packets.isError ? (
            <ErrorState message={packets.error.message} />
          ) : (
            <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full font-mono text-xs">
                <caption className="sr-only">Pacotes enviados</caption>
                <thead className="sticky top-0 bg-slate-50 text-left font-sans">
                  <tr>
                    <th scope="col" className="px-2 py-1">
                      Hora
                    </th>
                    <th scope="col" className="px-2 py-1">
                      MAC
                    </th>
                    <th scope="col" className="px-2 py-1">
                      De
                    </th>
                    <th scope="col" className="px-2 py-1">
                      Para
                    </th>
                    <th scope="col" className="px-2 py-1">
                      Porta
                    </th>
                    <th scope="col" className="px-2 py-1">
                      #
                    </th>
                    <th scope="col" className="px-2 py-1">
                      Resultado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {packets.data.map((p, i) => (
                    <tr key={i} className={p.outcome === 'error' ? 'text-red-800' : ''}>
                      <td className="px-2 py-0.5">{formatTime(p.at)}</td>
                      <td className="px-2 py-0.5">{p.mac}</td>
                      <td className="px-2 py-0.5">{p.srcIp}</td>
                      <td className="px-2 py-0.5">{p.dstIp}</td>
                      <td className="px-2 py-0.5">{p.port}</td>
                      <td className="px-2 py-0.5">{p.repeat + 1}</td>
                      <td className="px-2 py-0.5">
                        {p.outcome === 'sent'
                          ? 'enviado'
                          : p.outcome === 'dry_run'
                            ? 'simulado'
                            : `erro ${p.error ?? ''}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </section>
  );
}
