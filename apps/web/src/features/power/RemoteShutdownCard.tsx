import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AGENT_READINESS_LABELS,
  type DeviceAgentInfo,
  FREEZE_STATE_LABELS,
  type FreezeState,
} from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { useMe } from '../../auth/auth';
import { ErrorState, LoadingState } from '../../components/Banner';
import { FormError } from '../../components/form';
import { HelpLink } from '../help/HelpPage';
import { Button, ConfirmDialog } from '../../components/ui';
import { formatDateTime, plural } from '../../lib/format';
import { READINESS_SHORT, READINESS_TONE, revokeAgent, useDeviceAgent } from './api';
import { ShutdownDiagnosticsPanel } from './ShutdownDiagnosticsPanel';

const PRODUCTS: Record<string, string> = {
  deep_freeze: 'Deep Freeze',
  uwf: 'Filtro de Gravação Unificado (UWF)',
  reboot_restore_rx: 'Reboot Restore Rx',
  shadow_defender: 'Shadow Defender',
};

const WAKE_TIMERS: Record<string, string> = {
  enabled: 'ativados',
  disabled: 'desativados',
  important_only: 'só os importantes (o UniWake pode não acordar o PC)',
  unknown: 'desconhecido',
};

export function freezeText(a: Pick<DeviceAgentInfo, 'freezeState' | 'freezeProduct'>): string {
  if (!a.freezeState) return 'não verificado';
  const label = FREEZE_STATE_LABELS[a.freezeState as FreezeState] ?? 'não verificado';
  return a.freezeProduct ? `${label}: ${PRODUCTS[a.freezeProduct] ?? a.freezeProduct}` : label;
}

export function sleepText(minutes: number | null): string {
  if (minutes === null) return 'desconhecida';
  return minutes === 0 ? 'nunca' : `após ${plural(minutes, 'minuto', 'minutos')}`;
}

/** "Desligamento remoto" on the device page (FR-309, FR-308.1, owner Q-3/Q-6). */
export function RemoteShutdownCard({
  deviceId,
  deviceName,
}: {
  deviceId: number;
  deviceName: string;
}) {
  const q = useDeviceAgent(deviceId);
  const me = useMe();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me.data?.role === 'admin';

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeAgent(deviceId);
      setConfirm(false);
      await qc.invalidateQueries({ queryKey: ['power'] });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="desligamento-remoto"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="desligamento-remoto" className="text-lg font-bold">
        Desligamento remoto
      </h2>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <AgentDetails agent={q.data} />
          <ShutdownDiagnosticsPanel
            deviceId={deviceId}
            deviceName={deviceName}
            ready={q.data.readiness === 'ready'}
          />
        </>
      )}
      <FormError message={error} />
      {isAdmin && q.data && (q.data.readiness === 'ready' || q.data.readiness === 'lost') && (
        <Button variant="danger" className="mt-3" onClick={() => setConfirm(true)}>
          Revogar desligamento remoto
        </Button>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Revogar desligamento remoto de ${deviceName}?`}
        confirmLabel="Revogar"
        danger
        busy={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setConfirm(false)}
      >
        <p>
          Esta máquina deixa de receber ordens e agendamentos de desligar. Ela continua sendo ligada
          normalmente. Para voltar, execute de novo o comando de "Preparar máquinas" nela.
        </p>
      </ConfirmDialog>
    </section>
  );
}

function AgentDetails({ agent: a }: { agent: DeviceAgentInfo }) {
  const offsetMin = a.clockOffsetMs === null ? 0 : Math.round(a.clockOffsetMs / 60_000);
  const rows: [string, string][] = [
    [
      'Última consulta ao UniWake',
      a.lastCheckin === null ? 'nunca' : formatDateTime(a.lastCheckin),
    ],
    ['Versão do agente', a.agentVersion ?? '—'],
    ['Congelamento', freezeText(a)],
    ['Pasta persistente', a.persistentArea ? 'sim' : 'não'],
    ['Suspensão (na tomada)', sleepText(a.sleepAfterMinutes)],
    ['Temporizadores de ativação', WAKE_TIMERS[a.wakeTimers ?? 'unknown'] ?? 'desconhecido'],
    [
      'Usuário logado (última consulta)',
      a.userLoggedOn === null
        ? '—'
        : a.userLoggedOn
          ? `sim (${plural(a.sessions ?? 1, 'sessão', 'sessões')})`
          : 'não',
    ],
  ];
  if (Math.abs(offsetMin) >= 2) {
    rows.push([
      'Relógio da máquina',
      `${Math.abs(offsetMin)} min ${offsetMin > 0 ? 'atrasado' : 'adiantado'}`,
    ]);
  }
  return (
    <div className="mt-2 space-y-3">
      <p>
        <span
          className={`rounded px-2 py-0.5 text-sm font-semibold ${READINESS_TONE[a.readiness]}`}
        >
          {READINESS_SHORT[a.readiness]}
        </span>
      </p>
      {a.readiness !== 'ready' && (
        <p className="text-sm text-slate-700">{AGENT_READINESS_LABELS[a.readiness]}.</p>
      )}
      {a.readiness === 'needs_preparation' && (
        <p className="text-sm text-slate-700">
          Para desligar esta máquina pelo UniWake, execute nela o comando atualizado de "Preparar
          máquinas".
        </p>
      )}
      {(a.readiness === 'lost' || a.readiness === 'needs_preparation') && (
        <p className="text-sm">
          <HelpLink topic={a.readiness === 'lost' ? 'frozen-labs' : 'remote-shutdown'} />
        </p>
      )}
      {a.readiness !== 'needs_preparation' && (
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1">
              <dt className="text-slate-600">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
