import { useState } from 'react';
import { Link } from 'react-router';
import type { PowerJob } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { ErrorState, LoadingState } from '../../components/Banner';
import { FormError } from '../../components/form';
import { Button } from '../../components/ui';
import { cancelPowerJob, OPEN_STATES, powerStateLabel, usePowerJob } from './api';

const TITLE = { shutdown: 'Desligamento', restart: 'Reinício' } as const;

/** Live progress of a manual shutdown/restart (FR-305): one line per machine, with "Cancelar". */
export function PowerDrawer({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const q = usePowerJob(jobId);
  return (
    <aside
      aria-label="Andamento do desligamento"
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-lg font-bold">
          {q.data ? TITLE[q.data.action] : 'Desligamento'} #{jobId}
        </h2>
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
          <PowerProgress job={q.data} onChanged={() => void q.refetch()} />
        )}
      </div>
    </aside>
  );
}

export function PowerProgress({ job, onChanged }: { job: PowerJob; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = job.devices.some((d) => d.state === 'pending' || d.state === 'received');
  const moving = job.devices.some((d) => OPEN_STATES.includes(d.state));
  const p = job.policy;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await cancelPowerJob(job.id);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-slate-700">
        {job.label} · aviso de {p.warningMinutes} min
        {p.allowPostpone ? `, até ${p.postponeMax}× adiar` : ''}
      </p>
      <p role="status" aria-live="polite" className="font-semibold">
        {moving
          ? 'Em andamento: as máquinas recebem a ordem na próxima consulta (até 1 min).'
          : 'Concluído.'}
      </p>
      <ul className="space-y-1 text-sm">
        {job.devices.map((d) => (
          <li
            key={d.deviceId}
            className="flex justify-between gap-3 border-b border-slate-100 py-1"
          >
            <Link to={`/dispositivos/${d.deviceId}`} className="text-blue-800 underline">
              {d.name}
            </Link>
            <span className="text-right text-slate-800">
              {powerStateLabel(d.state, job.action)}
              {d.postpones > 0 ? ` (adiado ${d.postpones}× pelo usuário)` : ''}
            </span>
          </li>
        ))}
      </ul>
      <FormError message={error} />
      {open && (
        <Button variant="danger" onClick={() => void cancel()} disabled={busy}>
          Cancelar o que ainda não executou
        </Button>
      )}
    </div>
  );
}
