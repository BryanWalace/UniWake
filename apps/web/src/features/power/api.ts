import { useQuery } from '@tanstack/react-query';
import type {
  AgentReadinessState,
  DeviceAgentInfo,
  PowerDeviceState,
  PowerHistory,
  PowerJob,
  PowerPreview,
  PowerRequest,
} from '@uniwake/shared';
import { api } from '../../api/client';
import { useRealtimeState } from '../../realtime/RealtimeProvider';

export const previewPower = (req: PowerRequest) =>
  api.post<PowerPreview>('/api/power/preview', req);
export const startPower = (req: PowerRequest) =>
  api.post<{ jobId: number; count: number }>('/api/power/jobs', req);
export const cancelPowerJob = (id: number) => api.post<PowerJob>(`/api/power/jobs/${id}/cancel`);
export const revokeAgent = (deviceId: number) =>
  api.post<DeviceAgentInfo>(`/api/devices/${deviceId}/agent/revoke`);

export const powerJobKey = (id: number) => ['power', 'jobs', id] as const;
export const agentsKey = ['power', 'agents'] as const;

/** A job is still moving while any machine has not reached a final state. */
export const OPEN_STATES: readonly PowerDeviceState[] = ['pending', 'received', 'confirming'];

/** Live over SSE (`power.job`), with a poll as a safety net while the job is open. */
export function usePowerJob(id: number | null) {
  const live = useRealtimeState() === 'open';
  return useQuery({
    queryKey: powerJobKey(id ?? 0),
    queryFn: () => api.get<PowerJob>(`/api/power/jobs/${id}`),
    enabled: id !== null,
    refetchInterval: (q) => {
      const open = q.state.data?.devices.some((d) => OPEN_STATES.includes(d.state)) ?? true;
      return open ? (live ? 5000 : 2000) : false;
    },
  });
}

/** Every machine's agent (readiness badges, FR-309). */
export function useAgents() {
  return useQuery({
    queryKey: agentsKey,
    queryFn: () => api.get<DeviceAgentInfo[]>('/api/power/agents'),
    refetchInterval: 30_000,
  });
}

export function useDeviceAgent(deviceId: number) {
  return useQuery({
    queryKey: ['power', 'agents', deviceId],
    queryFn: () => api.get<DeviceAgentInfo>(`/api/devices/${deviceId}/agent`),
    refetchInterval: 30_000,
  });
}

export function usePowerHistory() {
  return useQuery({
    queryKey: ['power', 'history'],
    queryFn: () => api.get<PowerHistory>('/api/power/history'),
    refetchInterval: 30_000,
  });
}

export const READINESS_TONE: Record<AgentReadinessState, string> = {
  ready: 'bg-emerald-100 text-emerald-900',
  needs_preparation: 'bg-slate-100 text-slate-800',
  revoked: 'bg-slate-200 text-slate-800',
  lost: 'bg-amber-100 text-amber-950',
};

/** Short badge text; the full sentence is AGENT_READINESS_LABELS. */
export const READINESS_SHORT: Record<AgentReadinessState, string> = {
  ready: 'Pronta para desligar',
  needs_preparation: 'Precisa do novo preparo',
  revoked: 'Desligamento revogado',
  lost: 'Desligamento remoto perdido',
};

export function powerStateLabel(state: PowerDeviceState, action: 'shutdown' | 'restart'): string {
  switch (state) {
    case 'pending':
      return 'Ordem enviada (aguardando a máquina)';
    case 'received':
      return 'Recebida — aviso em andamento';
    case 'confirming':
      return action === 'restart' ? 'Reiniciando…' : 'Desligando… (confirmando pela rede)';
    case 'done':
      return action === 'restart' ? 'Reiniciou' : 'Desligou';
    case 'not_confirmed':
      return 'Não confirmou (continua respondendo na rede)';
    case 'cancelled':
      return 'Cancelada';
    case 'expired':
      return 'Expirou (a máquina não consultou o UniWake em 2 h)';
    case 'failed':
      return 'Falhou';
  }
}
