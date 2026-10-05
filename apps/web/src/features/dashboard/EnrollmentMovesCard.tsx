import { Link } from 'react-router';
import type { DashboardNotice, EnrollmentMoves } from '@uniwake/shared';
import { Button } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useAcknowledgeNotice } from '../schedules/api';

/** AC-007-07: machines moved to another room by "Preparar máquinas" in the last 24 h. */
export function EnrollmentMovesCard({ notice }: { notice: DashboardNotice }) {
  const ack = useAcknowledgeNotice();
  const { moves } = notice.data as unknown as EnrollmentMoves;
  return (
    <article
      aria-label="Computadores que mudaram de sala"
      className="rounded-lg border border-sky-300 bg-sky-50 p-4 text-sky-950"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold">Computadores que mudaram de sala</h2>
        <Button onClick={() => ack.mutate(notice.id)} disabled={ack.isPending}>
          Ciente
        </Button>
      </div>
      <p className="mt-1 text-sm">
        Ao serem preparados, estes computadores informaram outra sala e foram movidos:
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {moves.map((m) => (
          <li key={`${m.deviceId}-${m.at}`}>
            <Link to={`/dispositivos/${m.deviceId}`} className="font-semibold underline">
              {m.deviceName}
            </Link>
            : {m.from} → {m.to} <span className="text-sky-800">({formatDateTime(m.at)})</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
