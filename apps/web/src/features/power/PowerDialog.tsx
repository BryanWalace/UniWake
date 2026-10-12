import { useEffect, useState } from 'react';
import type { PowerDeviceRef, PowerPreview, PowerRequest, WakeTarget } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { LoadingState } from '../../components/Banner';
import { FormError } from '../../components/form';
import { Button, Dialog } from '../../components/ui';
import { plural } from '../../lib/format';
import { previewPower, startPower } from './api';

export interface PowerIntent {
  title: string;
  action: 'shutdown' | 'restart';
  target: WakeTarget;
}

const VERB = { shutdown: 'desligar', restart: 'reiniciar' } as const;

/**
 * Preview → confirmation → orders (FR-305, owner Q-1/Q-7). Shows how many machines will receive
 * the order, which need the new preparation, how many have a user logged on and which are marked
 * "Nunca desligar por agendamento"; the warning is 1 min without postpone unless chosen otherwise.
 */
export function PowerDialog({
  intent,
  onClose,
  onStarted,
}: {
  intent: PowerIntent | null;
  onClose: () => void;
  onStarted: (jobId: number) => void;
}) {
  if (!intent) return null;
  return (
    <PowerDialogBody
      key={JSON.stringify(intent)}
      intent={intent}
      onClose={onClose}
      onStarted={onStarted}
    />
  );
}

function names(list: PowerDeviceRef[], max = 6): string {
  const shown = list.slice(0, max).map((d) => d.name);
  return list.length > max ? `${shown.join(', ')} e mais ${list.length - max}` : shown.join(', ');
}

function PowerDialogBody({
  intent,
  onClose,
  onStarted,
}: {
  intent: PowerIntent;
  onClose: () => void;
  onStarted: (jobId: number) => void;
}) {
  const [warning, setWarning] = useState<'short' | 'standard'>('short');
  const [preview, setPreview] = useState<PowerPreview | null>(null);
  const [confirmProtected, setConfirmProtected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request: PowerRequest = { action: intent.action, target: intent.target, warning };
  const verb = VERB[intent.action];

  useEffect(() => {
    let cancelled = false;
    previewPower({ action: intent.action, target: intent.target, warning })
      .then((p) => !cancelled && setPreview(p))
      .catch(
        (e: unknown) =>
          !cancelled && setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.'),
      );
    return () => {
      cancelled = true;
    };
  }, [intent, warning]);

  async function start() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await startPower({
        ...request,
        confirmProtected,
        ...(preview.needsConfirmation ? { confirm: { count: preview.count } } : {}),
      });
      onStarted(r.jobId);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'CONFIRMATION_REQUIRED') {
        setPreview(await previewPower(request));
        setError('A quantidade de máquinas mudou. Confira e confirme novamente.');
      } else {
        setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
      }
    } finally {
      setBusy(false);
    }
  }

  const blockedByProtected = (preview?.protected.length ?? 0) > 0 && !confirmProtected;
  const nothing = preview !== null && preview.count === 0;
  const p = preview?.policy;

  return (
    <Dialog
      open
      title={intent.title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={() => void start()}
            disabled={!preview || nothing || busy || blockedByProtected}
          >
            {preview?.needsConfirmation
              ? `Confirmar: ${verb} ${plural(preview.count, 'máquina', 'máquinas')}`
              : `${verb[0]!.toUpperCase()}${verb.slice(1)} ${preview ? plural(preview.count, 'máquina', 'máquinas') : ''}`}
          </Button>
        </>
      }
    >
      {!preview && !error && <LoadingState label="Calculando quais máquinas recebem a ordem…" />}
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
            {nothing
              ? `Nenhuma máquina pronta para ${verb}.`
              : `Vai ${verb} ${plural(preview.count, 'máquina', 'máquinas')}${preview.rooms.length > 0 ? ` em ${preview.rooms.map((r) => `${r.name} (${r.count})`).join(', ')}` : ''}.`}
            {preview.needsConfirmation &&
              ' Esta é uma ação grande: confira o número antes de confirmar.'}
          </p>
          {preview.withUser > 0 && (
            <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-950">
              {plural(preview.withUser, 'máquina tem', 'máquinas têm')} alguém usando agora: o aviso
              aparece na tela e o que não estiver salvo será perdido.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {preview.needsPreparation.length > 0 && (
              <li>
                {plural(preview.needsPreparation.length, 'máquina precisa', 'máquinas precisam')} do
                novo comando de "Preparar máquinas" e não{' '}
                {preview.needsPreparation.length === 1 ? 'recebe' : 'recebem'} a ordem:{' '}
                {names(preview.needsPreparation)}.
              </li>
            )}
            {preview.lost.length > 0 && (
              <li>
                {plural(preview.lost.length, 'máquina está', 'máquinas estão')} com "Desligamento
                remoto perdido" e não {preview.lost.length === 1 ? 'recebe' : 'recebem'} a ordem:{' '}
                {names(preview.lost)}.
              </li>
            )}
            {preview.revoked.length > 0 && (
              <li>Desligamento remoto revogado em {names(preview.revoked)}.</li>
            )}
            {preview.offline > 0 && (
              <li>
                {plural(preview.offline, 'máquina parece desligada', 'máquinas parecem desligadas')}
                : a ordem espera até 2 h pela consulta dela.
              </li>
            )}
          </ul>
          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold">Aviso na tela</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="warning"
                checked={warning === 'short'}
                onChange={() => {
                  setError(null);
                  setWarning('short');
                }}
              />
              Aviso: 1 min, sem adiar
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="warning"
                checked={warning === 'standard'}
                onChange={() => {
                  setError(null);
                  setWarning('standard');
                }}
              />
              5 min com adiamento (padrão dos agendamentos)
            </label>
            {p && (
              <p className="text-xs text-slate-600">
                Aviso de {plural(p.warningMinutes, 'minuto', 'minutos')}
                {p.allowPostpone
                  ? `; o usuário pode adiar ${plural(p.postponeMax, 'vez', 'vezes')} de ${p.postponeMinutes} min.`
                  : '; sem adiar.'}
              </p>
            )}
          </fieldset>
          {preview.protected.length > 0 && (
            <label className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-950">
              <input
                type="checkbox"
                checked={confirmProtected}
                onChange={(e) => setConfirmProtected(e.target.checked)}
              />
              <span>
                {names(preview.protected)}{' '}
                {preview.protected.length === 1 ? 'está marcada' : 'estão marcadas'} "Nunca desligar
                por agendamento". Marque para {verb} também.
              </span>
            </label>
          )}
        </div>
      )}
    </Dialog>
  );
}
