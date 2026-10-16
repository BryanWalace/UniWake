import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SHUTDOWN_REASON_LABEL,
  SHUTDOWN_RESULT_LABEL,
  SHUTDOWN_TEST_MINUTES,
  type ShutdownDiagnostics,
  type ShutdownTest,
} from '@uniwake/shared';
import { api, ApiRequestError } from '../../api/client';
import { FormError, TextField } from '../../components/form';
import { Button, ConfirmDialog } from '../../components/ui';
import { formatDateTime, plural } from '../../lib/format';

const PATH = { agenda: 'pela agenda', order: 'por ordem direta' } as const;

export const useShutdownDiagnostics = (deviceId: number) =>
  useQuery({
    queryKey: ['power', 'diagnostics', deviceId],
    queryFn: () => api.get<ShutdownDiagnostics>(`/api/devices/${deviceId}/shutdown-diagnostics`),
    refetchInterval: 30_000,
  });

/**
 * v1.6 (FR-502.1, FR-504.1): why this machine will or will not shut down on a schedule — what it
 * was last given, what the hub would give now, and each "Desligar" schedule with its reason.
 */
export function ShutdownDiagnosticsPanel({
  deviceId,
  deviceName,
  ready,
}: {
  deviceId: number;
  deviceName: string;
  /** The agent is ready: "Testar agendamento" is offered. */
  ready: boolean;
}) {
  const q = useShutdownDiagnostics(deviceId);
  if (q.isPending || q.isError) return null; // the card above already shows loading/error
  const { agenda: a, schedules, lastShutdown, test } = q.data;
  const stale = a.servedVersion !== null && a.servedVersion !== a.currentVersion;
  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 text-sm">
      <h3 className="font-semibold">Desligamento agendado</h3>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Row
          k="Próximo desligamento"
          v={
            a.nextShutdownAt === null
              ? 'nenhum nos próximos 14 dias'
              : formatDateTime(a.nextShutdownAt)
          }
        />
        <Row
          k="Agenda entregue à máquina"
          v={
            a.servedVersion === null
              ? 'nunca'
              : `${a.servedItems ?? 0} horário(s), versão ${a.servedVersion.slice(0, 8)}, ${formatDateTime(a.servedAt)}`
          }
        />
        <Row
          k="Agenda atual no UniWake"
          v={`${a.currentItems} horário(s), versão ${(a.currentVersion ?? '—').slice(0, 8)}`}
        />
        <Row
          k="Último desligamento"
          v={
            lastShutdown === null
              ? 'nenhum relatório ainda'
              : `${SHUTDOWN_RESULT_LABEL[lastShutdown.result]}${lastShutdown.path ? ` ${PATH[lastShutdown.path]}` : ''}, ${formatDateTime(lastShutdown.at)}`
          }
        />
        {test && <Row k="Teste de agendamento" v={testText(test)} />}
      </dl>
      {stale && (
        <p className="text-amber-900">
          A máquina ainda não recebeu a agenda atual: ela recebe na próxima consulta (até 1 minuto
          depois de ligada).
        </p>
      )}
      {schedules.length === 0 ? (
        <p className="text-slate-700">Nenhum agendamento de desligar existe.</p>
      ) : (
        <ul aria-label="Agendamentos de desligar" className="space-y-1">
          {schedules.map((s) => (
            <li
              key={s.scheduleId}
              className={s.reason === 'included' ? 'text-green-900' : 'text-slate-800'}
            >
              <strong>{s.name}</strong>: {SHUTDOWN_REASON_LABEL[s.reason]}
              {s.nextAt !== null && ` — próximo em ${formatDateTime(s.nextAt)}`}
            </li>
          ))}
        </ul>
      )}
      {ready && <TestShutdown deviceId={deviceId} deviceName={deviceName} />}
    </div>
  );
}

function testText(t: ShutdownTest): string {
  const when = `desligar às ${formatDateTime(t.at)} (aviso de ${plural(t.warningMinutes, 'minuto', 'minutos')})`;
  if (t.result) {
    return `${when}: ${SHUTDOWN_RESULT_LABEL[t.result]}${t.path ? ` ${PATH[t.path]}` : ''}`;
  }
  return `${when}: ${t.pushedAt === null ? 'agendado (a máquina recebe na próxima consulta ao UniWake)' : 'ordem enviada, aguardando o horário'}`;
}

/** FR-504.3: a one-off scheduled shutdown of this machine, through both paths. */
function TestShutdown({ deviceId, deviceName }: { deviceId: number; deviceName: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(SHUTDOWN_TEST_MINUTES.default));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(minutes);
  const valid =
    Number.isInteger(n) && n >= SHUTDOWN_TEST_MINUTES.min && n <= SHUTDOWN_TEST_MINUTES.max;

  async function start() {
    if (!valid) {
      setError(`Escolha de ${SHUTDOWN_TEST_MINUTES.min} a ${SHUTDOWN_TEST_MINUTES.max} minutos.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/devices/${deviceId}/shutdown-test`, { minutes: n });
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['power'] });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Testar agendamento</Button>
      <ConfirmDialog
        open={open}
        title={`Testar o desligamento agendado de ${deviceName}?`}
        confirmLabel="Agendar teste"
        busy={busy}
        onConfirm={() => void start()}
        onCancel={() => setOpen(false)}
      >
        <p>
          A máquina recebe um desligamento agendado só para ela, pela agenda e por ordem direta,
          como um agendamento de verdade: mostra o aviso na tela e desliga no horário. Use numa
          máquina que pode ser desligada agora.
        </p>
        <TextField
          className="mt-3"
          label="Desligar daqui a (minutos)"
          hint={`De ${SHUTDOWN_TEST_MINUTES.min} a ${SHUTDOWN_TEST_MINUTES.max} minutos.`}
          type="number"
          min={SHUTDOWN_TEST_MINUTES.min}
          max={SHUTDOWN_TEST_MINUTES.max}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <FormError message={error} />
      </ConfirmDialog>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1">
      <dt className="text-slate-600">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
