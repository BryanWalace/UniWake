import { useQuery } from '@tanstack/react-query';
import type { PowerDeviceRef, WakeTarget } from '@uniwake/shared';
import { plural } from '../../lib/format';
import { previewPower } from './api';

const names = (list: readonly PowerDeviceRef[]) =>
  list
    .slice(0, 5)
    .map((d) => d.name)
    .join(', ') + (list.length > 5 ? ` e mais ${list.length - 5}` : '');

const emptyTarget = (t: WakeTarget) =>
  (t.type === 'rooms' && t.roomIds.length === 0 && !t.includeNoRoom) ||
  (t.type === 'tags' && t.tagIds.length === 0) ||
  (t.type === 'devices' && t.deviceIds.length === 0);

/**
 * v1.6 (FR-501.5, FR-502): who a "Desligar" schedule reaches today — ready machines, the ones that
 * still need the preparation command and whether the PC running UniWake is among them.
 */
export function ShutdownReach({ target }: { target: WakeTarget }) {
  const q = useQuery({
    queryKey: ['power', 'reach', target],
    queryFn: () => previewPower({ action: 'shutdown', target, warning: 'standard' }),
    enabled: !emptyTarget(target),
  });
  if (emptyTarget(target)) return null;
  if (q.isPending) return <p className="text-sm text-slate-600">Verificando as máquinas…</p>;
  if (q.isError) return null; // the schedule can still be saved; the form shows its own errors
  const p = q.data;
  const notReady = [...p.needsPreparation, ...p.revoked, ...p.lost];
  return (
    <div className="space-y-2 text-sm" aria-live="polite">
      <p>
        Hoje este agendamento alcança{' '}
        <strong>{plural(p.count, 'máquina pronta', 'máquinas prontas')}</strong> para desligar.
        {notReady.length > 0 && (
          <>
            {' '}
            {plural(notReady.length, 'máquina não está pronta', 'máquinas não estão prontas')} (
            {names(notReady)}): rode nelas o comando de "Preparar máquinas".
          </>
        )}
      </p>
      {p.self.length > 0 && (
        <p
          role="alert"
          className="rounded-md border border-amber-400 bg-amber-50 p-2 text-amber-950"
        >
          Inclui este PC, que roda o UniWake ({names(p.self)}): ele também vai desligar no horário,
          e os agendamentos e o painel param até ele ligar de novo.
        </p>
      )}
    </div>
  );
}
