import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TeamConflict,
  TeamDiscovered,
  TeamJoin,
  TeamMemberUpdate,
  TeamStatus,
} from '@uniwake/shared';
import { api } from '../../api/client';

export const teamKeys = {
  status: ['team'] as const,
  discovered: ['team', 'discovered'] as const,
  conflicts: ['team', 'conflicts'] as const,
};

/** FR-202.6: refreshed every 5 s so online/offline and pending counts stay current. */
export function useTeam() {
  return useQuery({
    queryKey: teamKeys.status,
    queryFn: () => api.get<TeamStatus>('/api/team'),
    refetchInterval: 5000,
  });
}

/** PCs announcing an open pairing on the LAN (FR-201.2), polled while the join form is open. */
export function useDiscovered(enabled: boolean) {
  return useQuery({
    queryKey: teamKeys.discovered,
    queryFn: () => api.get<TeamDiscovered[]>('/api/team/discovered'),
    refetchInterval: 3000,
    enabled,
  });
}

export function useConflicts() {
  return useQuery({
    queryKey: teamKeys.conflicts,
    queryFn: () => api.get<TeamConflict[]>('/api/team/conflicts'),
  });
}

function useTeamMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // A join or a sync can change anything on this PC.
    onSuccess: () => qc.invalidateQueries(),
  });
}

export const useOpenPairing = () =>
  useTeamMutation(() => api.post<TeamStatus>('/api/team/pairing'));
export const useCancelPairing = () => useTeamMutation(() => api.del('/api/team/pairing'));
export const useJoinTeam = () =>
  useTeamMutation((v: TeamJoin) => api.post<TeamStatus>('/api/team/join', v));
export const useSyncNow = () => useTeamMutation(() => api.post<TeamStatus>('/api/team/sync'));
export const useUpdateMember = () =>
  useTeamMutation((v: { instanceId: string } & TeamMemberUpdate) => {
    const { instanceId, ...body } = v;
    return api.patch<TeamStatus>(`/api/team/members/${instanceId}`, body);
  });
export const useRevokeMember = () =>
  useTeamMutation((instanceId: string) =>
    api.post<TeamStatus>(`/api/team/members/${instanceId}/revoke`),
  );
export const useLeaveTeam = () => useTeamMutation(() => api.post<TeamStatus>('/api/team/leave'));
export const useWakeMissed = () =>
  useTeamMutation((noticeId: number) =>
    api.post<{ jobId: number }>(`/api/notices/${noticeId}/wake-missed`),
  );
