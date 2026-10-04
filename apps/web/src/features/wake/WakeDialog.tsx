import { useEffect, useState } from 'react';
import type { WakePreview, WakeTarget } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog } from '../../components/ui';
import { plural } from '../../lib/format';
import { previewWake, startWake } from './api';

export interface WakeIntent {
  title: string;
  target: WakeTarget;
  onlyOffline?: boolean;
}

const EXCLUSION_TEXT = {
  online: (n: number) =>
    `${plural(n, 'máquina já ligada', 'máquinas já ligadas')} (não será enviada)`,
  disabled: (n: number) => `${plural(n, 'máquina desativada', 'máquinas desativadas')}`,
  in_active_job: (n: number) =>
    `${plural(n, 'máquina já está', 'máquinas já estão')} em uma ligação em andamento`,
} as const;

/**
 * Preview → (confirmation) → start (FR-003.3, SR-10). The preview always shows how many machines
 * will be woken and where; large actions require confirming that exact count.
 */
export function WakeDialog({
  intent,
  onClose,
  onStarted,
}: {
  intent: WakeIntent | null;
  onClose: () => void;
  onStarted: (jobId: number) => void;
}) {
  if (!intent) return null;
  return (
    <WakeDialogBody
      key={JSON.stringify(intent)}
      intent={intent}
      onClose={onClose}
      onStarted={onStarted}
    />
  );
}

function WakeDialogBody({
  intent,
  onClose,
  onStarted,
}: {
  intent: WakeIntent;
  onClose: () => void;
  onStarted: (jobId: number) => void;
}) {
  const [preview, setPreview] = useState<WakePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [batchSize, setBatchSize] = useState('');
  const [delay, setDelay] = useState('');
  const [runningJob, setRunningJob] = useState<number | null>(null);
  const request = { target: intent.target, onlyOffline: intent.onlyOffline ?? false };

  useEffect(() => {
    let cancelled = false;
    previewWake(request)
      .then((p) => !cancelled && setPreview(p))
      .catch(
        (e: unknown) =>
          !cancelled && setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.'),
      );
    return () => {
      cancelled = true;
    };
    // The body is keyed by the intent, so this runs once per opened dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const stagger =
        advanced && batchSize && delay !== ''
          ? { batchSize: Number(batchSize), batchDelaySeconds: Number(delay) }
          : undefined;
      const r = await startWake({
        ...request,
        ...(preview.needsConfirmation ? { confirm: { count: preview.count } } : {}),
        ...(stagger ? { stagger } : {}),
      });
      onStarted(r.jobId);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'CONFIRMATION_REQUIRED') {
        // The set changed since the preview (new machines, status changes): show the new numbers.
        setPreview(await previewWake(request));
        setError('A quantidade de máquinas mudou. Confira e confirme novamente.');
      } else if (e instanceof ApiRequestError && e.code === 'WAKE_ALREADY_RUNNING') {
        const ids = (e.details as { jobIds?: number[] } | undefined)?.jobIds ?? [];
        setRunningJob(ids[0] ?? null);
        setError(e.message);
      } else {
        setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
      }
    } finally {
      setBusy(false);
    }
  }

  const counts = new Map<string, number>();
  for (const x of preview?.excluded ?? []) counts.set(x.reason, (counts.get(x.reason) ?? 0) + 1);
  const nothingToDo = preview !== null && preview.count === 0;

  return (
    <Dialog
      open
      title={intent.title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          {runningJob !== null && (
            <Button onClick={() => onStarted(runningJob)}>Acompanhar ligação em andamento</Button>
          )}
          <Button
            variant={preview?.needsConfirmation ? 'danger' : 'primary'}
            onClick={() => void start()}
            disabled={!preview || nothingToDo || busy}
          >
            {preview?.needsConfirmation
              ? `Confirmar: ligar ${plural(preview.count, 'máquina', 'máquinas')}`
              : `Ligar ${preview ? plural(preview.count, 'máquina', 'máquinas') : ''}`}
          </Button>
        </>
      }
    >
      {!preview && !error && <LoadingState label="Calculando quais máquinas serão ligadas…" />}
      <FormError message={error} />
      {preview && (
        <div className="space-y-3">
          <p
            className={
              preview.needsConfirmation
                ? 'rounded-md border border-amber-400 bg-amber-50 p-3 font-semibold text-amber-950'
                : 'font-medium'
            }
          >
            {nothingToDo
              ? 'Nenhuma máquina será ligada.'
              : `Vai ligar ${plural(preview.count, 'máquina', 'máquinas')}${preview.rooms.length > 0 ? ` em ${preview.rooms.map((r) => `${r.name} (${r.count})`).join(', ')}` : ''}.`}
            {preview.needsConfirmation &&
              ' Esta é uma ação grande: confira o número antes de confirmar.'}
          </p>
          {counts.size > 0 && (
            <ul className="list-disc pl-5 text-sm text-slate-700">
              {[...counts].map(([reason, n]) => (
                <li key={reason}>{EXCLUSION_TEXT[reason as keyof typeof EXCLUSION_TEXT](n)}</li>
              ))}
            </ul>
          )}
          <details
            open={advanced}
            onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-sm font-medium text-blue-800">
              Opções avançadas (ligar aos poucos)
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <TextField
                label="Máquinas por lote"
                type="number"
                min={1}
                max={500}
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
              />
              <TextField
                label="Espera entre lotes (s)"
                type="number"
                min={0}
                max={600}
                value={delay}
                onChange={(e) => setDelay(e.target.value)}
              />
            </div>
          </details>
        </div>
      )}
    </Dialog>
  );
}
