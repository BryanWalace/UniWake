import { Link } from 'react-router';
import { DEVICE_RESULT_LABEL, type DashboardNotice, type MorningResult } from '@uniwake/shared';
import { Button } from '../../components/ui';
import { formatTime } from '../../lib/format';
import { useAcknowledgeNotice } from '../schedules/api';

const STATUS_TEXT = {
  executado: 'executado',
  atrasado: 'executado com atraso',
  falhou: 'falhou',
  perdido: 'perdido (o UniWake estava desligado)',
} as const;

/** "Resultado da manhã" (FR-013): pinned until someone clicks "Ciente". */
export function MorningResultCard({ notice }: { notice: DashboardNotice }) {
  const ack = useAcknowledgeNotice();
  const data = notice.data as unknown as MorningResult;
  const day = data.day.split('-').reverse().join('/');
  return (
    <article
      aria-label={`Resultado da manhã de ${day}`}
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold">Resultado da manhã — {day}</h2>
        <Button onClick={() => ack.mutate(notice.id)} disabled={ack.isPending}>
          Ciente
        </Button>
      </div>
      <ul className="mt-2 space-y-3 text-sm">
        {data.runs.map((r) => (
          <li key={`${r.scheduleId}-${r.plannedAt}`}>
            <p className="font-semibold">
              {r.scheduleName} às {formatTime(r.plannedAt).slice(0, 5)}: {STATUS_TEXT[r.status]}
              {r.detail ? ` (${r.detail})` : ''}
              {r.total > 0 && ` — ${r.woke}/${r.total} ligadas`}
              {r.jobId !== null && (
                <>
                  {' '}
                  <Link to={`/historico/jobs/${r.jobId}`} className="font-normal underline">
                    ver ligação
                  </Link>
                </>
              )}
            </p>
            {r.notWoken.map((room) => (
              <p key={room.roomId ?? 'none'}>
                {room.roomName}: não acordaram{' '}
                {room.devices.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 && ', '}
                    <Link
                      to={`/dispositivos/${d.id}#diagnostico`}
                      className="underline"
                      title={DEVICE_RESULT_LABEL[d.result]}
                    >
                      {d.name}
                    </Link>
                  </span>
                ))}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </article>
  );
}
