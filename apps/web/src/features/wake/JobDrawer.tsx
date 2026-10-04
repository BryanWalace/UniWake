import { Link } from 'react-router';
import { DEVICE_RESULT_LABEL, JOB_STATE_LABEL } from '@uniwake/shared';
import { ErrorState, LoadingState } from '../../components/Banner';
import { Button } from '../../components/ui';
import { formatDuration, useNow } from '../../lib/format';
import { FINAL_STATES, useJob } from './api';

/** Live progress of a wake job (FR-009, IMP-002). */
export function JobDrawer({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const q = useJob(jobId);
  const now = useNow();

  return (
    <aside
      aria-label="Andamento da ligação"
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-lg font-bold">Ligação #{jobId}</h2>
        <Button variant="ghost" onClick={onClose} aria-label="Fechar andamento">
          ✕
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
        ) : (
          <JobProgress detail={q.data} now={now} />
        )}
      </div>
    </aside>
  );
}

export function JobProgress({
  detail,
  now,
}: {
  detail: NonNullable<ReturnType<typeof useJob>['data']>;
  now: number;
}) {
  const { job, devices } = detail;
  const sent = devices.filter((d) => d.sentAt !== null).length;
  const final = FINAL_STATES.includes(job.state);
  const noResponse = devices.filter(
    (d) => d.result === 'nao_respondeu' || d.result === 'falha_no_envio',
  );
  return (
    <div className="space-y-4">
      <p className="text-slate-700">
        {job.targetLabel}
        {job.dryRun && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">
            simulação
          </span>
        )}
      </p>
      <p role="status" aria-live="polite" className="font-semibold">
        {JOB_STATE_LABEL[job.state]}
        {job.state === 'verificando' &&
          job.verifyUntil !== null &&
          ` — ${formatDuration(job.verifyUntil - now)} restantes`}
        {job.error === 'NO_NETWORK_INTERFACE' &&
          ': nenhuma placa de rede disponível no computador do UniWake. Verifique o cabo e a conexão de rede.'}
        {job.state === 'falhou' &&
          job.error !== 'NO_NETWORK_INTERFACE' &&
          ': erro inesperado. Veja os logs em Saúde do sistema e tente novamente.'}
        {job.state === 'interrompido' && ': o serviço foi reiniciado durante a ligação.'}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Stat label="Pacotes enviados" value={`${sent}/${job.summary.total}`} />
        <Stat label="Acordaram" value={job.summary.woke} />
        <Stat label="Já estavam ligadas" value={job.summary.alreadyOn} />
        <Stat label="Aguardando" value={job.summary.waiting} />
        <Stat label="Não responderam" value={job.summary.noResponse + job.summary.sendFailed} />
        <Stat label="Sem IP para verificar" value={job.summary.unverified} />
      </dl>
      {final && noResponse.length > 0 && (
        <div>
          <h3 className="font-semibold">Não responderam</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {noResponse.map((d) => (
              <li key={d.deviceId}>
                {d.name} — {DEVICE_RESULT_LABEL[d.result]}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-slate-600">
            Dica: veja "Ajuda" sobre BIOS, Fast Startup e rede se uma máquina nunca acorda.
          </p>
        </div>
      )}
      <Link
        to={`/historico/jobs/${job.id}`}
        className="inline-block text-sm text-blue-800 underline"
      >
        Ver detalhes e pacotes enviados
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-slate-50 p-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-lg font-bold">{value}</dd>
    </div>
  );
}
