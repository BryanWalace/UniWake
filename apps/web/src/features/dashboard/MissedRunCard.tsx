import type { DashboardNotice } from '@uniwake/shared';
import { Button } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useAcknowledgeNotice } from '../schedules/api';
import { useWakeMissed } from '../team/api';

interface MissedRun {
  scheduleId: number;
  scheduleName: string;
  plannedAt: number;
}

/** FR-204.2: a run missed while this PC was off; nobody else recorded it. Waking is a choice. */
export function MissedRunCard({ notice }: { notice: DashboardNotice }) {
  const ack = useAcknowledgeNotice();
  const wake = useWakeMissed();
  const r = notice.data as unknown as MissedRun;
  return (
    <article
      aria-label="Agendamento não executado"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
    >
      <h2 className="text-lg font-bold">Agendamento não executado</h2>
      <p className="mt-1 text-sm">
        “{r.scheduleName}” estava previsto para {formatDateTime(r.plannedAt)}, enquanto este PC
        estava desligado, e nenhum outro PC da equipe registrou a execução.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => wake.mutate(notice.id)} disabled={wake.isPending}>
          Ligar agora
        </Button>
        <Button onClick={() => ack.mutate(notice.id)} disabled={ack.isPending}>
          Ciente
        </Button>
      </div>
      {wake.isError && <p className="mt-2 text-sm text-red-800">{wake.error.message}</p>}
    </article>
  );
}
