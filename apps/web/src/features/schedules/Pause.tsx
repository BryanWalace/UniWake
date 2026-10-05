import { type FormEvent, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { Banner } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useDashboard } from '../dashboard/api';
import { usePauseScheduler, useResumeScheduler } from './api';

/** Red banner on every page while schedules are paused (FR-005.6). */
export function PauseBanner() {
  const dash = useDashboard();
  const resume = useResumeScheduler();
  const p = dash.data?.pause;
  if (!p) return null;
  return (
    <Banner tone="danger">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          <strong>Agendamentos pausados:</strong> {p.reason} — desde {formatDateTime(p.since)}
          {p.by ? ` por ${p.by}` : ''}
          {p.resumeAt !== null
            ? `; retomam sozinhos em ${formatDateTime(p.resumeAt)}.`
            : '. Nenhuma ligação automática acontecerá até retomar.'}
        </span>
        <button
          type="button"
          onClick={() => resume.mutate()}
          disabled={resume.isPending}
          className="rounded-md border border-red-400 bg-white px-2 py-0.5 font-semibold text-red-900 hover:bg-red-100"
        >
          Retomar agora
        </button>
      </span>
    </Banner>
  );
}

/** `datetime-local` value (local time) → UTC epoch ms. */
function localInputToMs(v: string): number | null {
  if (v.trim() === '') return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

export function PauseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <PauseBody onClose={onClose} />;
}

function PauseBody({ onClose }: { onClose: () => void }) {
  const pause = usePauseScheduler();
  const [reason, setReason] = useState('');
  const [resumeAt, setResumeAt] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setFormError(null);
    try {
      await pause.mutateAsync({ reason, resumeAt: localInputToMs(resumeAt) });
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'PAUSE_REASON_REQUIRED') {
        return setError(err.message);
      }
      setFormError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
    }
  }

  return (
    <Dialog
      open
      title="Pausar agendamentos"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="danger" type="submit" form="pause-form" disabled={pause.isPending}>
            Pausar
          </Button>
        </>
      }
    >
      <form id="pause-form" onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
        <p className="text-sm text-slate-700">
          Enquanto pausado, nenhum agendamento liga máquinas; as execuções ficam registradas como
          "pulado (pausa)". Ligar manualmente continua funcionando.
        </p>
        <FormError message={formError} />
        <TextField
          label="Motivo"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={error}
          placeholder="Ex.: Férias de julho"
          maxLength={200}
          required
        />
        <TextField
          label="Retomar automaticamente em (opcional)"
          type="datetime-local"
          value={resumeAt}
          onChange={(e) => setResumeAt(e.target.value)}
          hint="Deixe em branco para retomar manualmente."
        />
      </form>
    </Dialog>
  );
}
