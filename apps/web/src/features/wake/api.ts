import { useQuery } from '@tanstack/react-query';
import type {
  JobState,
  Page,
  WakeJob,
  WakeJobDevice,
  WakePreview,
  WakeRequest,
} from '@uniwake/shared';
import { api } from '../../api/client';
import { useRealtimeState } from '../../realtime/RealtimeProvider';

export const FINAL_STATES: readonly JobState[] = ['concluido', 'interrompido', 'falhou'];

export interface JobDetail {
  job: WakeJob;
  devices: WakeJobDevice[];
}

export interface PacketRow {
  deviceId: number;
  mac: string;
  srcIp: string;
  dstIp: string;
  port: number;
  repeat: number;
  at: number;
  outcome: 'sent' | 'error' | 'dry_run';
  error: string | null;
}

export const previewWake = (req: WakeRequest) => api.post<WakePreview>('/api/wake/preview', req);
export const startWake = (req: WakeRequest) =>
  api.post<{ jobId: number; count: number }>('/api/wake', req);

export const jobKey = (id: number) => ['jobs', id] as const;

/**
 * Job detail until the job reaches a final state: live over SSE, with a slow poll as a safety net
 * (every 2 s when the realtime channel is down).
 */
export function useJob(id: number | null) {
  const live = useRealtimeState() === 'open';
  return useQuery({
    queryKey: jobKey(id ?? 0),
    queryFn: () => api.get<JobDetail>(`/api/jobs/${id}`),
    enabled: id !== null,
    refetchInterval: (q) =>
      q.state.data && FINAL_STATES.includes(q.state.data.job.state) ? false : live ? 15_000 : 2000,
  });
}

export function useJobs(page: number) {
  return useQuery({
    queryKey: ['jobs', 'list', page],
    queryFn: () => api.get<Page<WakeJob>>('/api/jobs', { query: { page, pageSize: 50 } }),
    refetchInterval: 10_000,
  });
}

export function useJobPackets(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ['jobs', id, 'packets'],
    queryFn: () => api.get<PacketRow[]>(`/api/jobs/${id}/packets`),
    enabled,
  });
}
