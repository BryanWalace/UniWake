/** Dashboard and uptime queries (FR-004.5, FR-004.6). */
import { useQuery } from '@tanstack/react-query';
import type { Dashboard, UptimeSeries } from '@uniwake/shared';
import { api } from '../../api/client';
import { keys } from '../../api/hooks';

/** Live updates arrive over SSE (M4-T11); the interval is only a safety net. */
const FALLBACK_REFRESH_MS = 60_000;

export function useDashboard() {
  return useQuery({
    queryKey: keys.dashboard,
    queryFn: () => api.get<Dashboard>('/api/dashboard'),
    refetchInterval: FALLBACK_REFRESH_MS,
  });
}

export function useUptime(q: { deviceId?: number; roomId?: number; days: number }) {
  return useQuery({
    queryKey: keys.uptime(q),
    queryFn: () => api.get<UptimeSeries>('/api/uptime', { query: q }),
  });
}
