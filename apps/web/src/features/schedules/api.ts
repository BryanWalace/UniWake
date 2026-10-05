/** Schedules, exceptions, execution log, pause and notices (FR-005, FR-013). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NextRun,
  Page,
  Schedule,
  ScheduleCreate,
  ScheduleException,
  ScheduleExceptionCreate,
  SchedulerPause,
  SchedulerPauseInput,
  ScheduleRun,
  ScheduleUpdate,
} from '@uniwake/shared';
import { api } from '../../api/client';
import { keys } from '../../api/hooks';

export const scheduleKeys = {
  all: ['schedules'] as const,
  nextRuns: (id: number) => ['schedules', id, 'next-runs'] as const,
  exceptions: ['schedule-exceptions'] as const,
  runs: (q: { scheduleId?: number; page: number }) => ['schedule-runs', q] as const,
};

export function useSchedules() {
  return useQuery({
    queryKey: scheduleKeys.all,
    queryFn: () => api.get<Schedule[]>('/api/schedules'),
  });
}

export function useNextRuns(id: number, enabled = true) {
  return useQuery({
    queryKey: scheduleKeys.nextRuns(id),
    queryFn: () => api.get<NextRun[]>(`/api/schedules/${id}/next-runs`),
    enabled,
  });
}

/** Any schedule change can move next runs and the dashboard. */
function useInvalidateSchedules() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: scheduleKeys.all }),
      qc.invalidateQueries({ queryKey: scheduleKeys.exceptions }),
      qc.invalidateQueries({ queryKey: keys.dashboard }),
    ]);
}

export function useSaveSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: ScheduleCreate | ScheduleUpdate }) =>
      id === undefined
        ? api.post<Schedule>('/api/schedules', data)
        : api.patch<Schedule>(`/api/schedules/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/schedules/${id}`),
    onSuccess: invalidate,
  });
}

export function useExceptions() {
  return useQuery({
    queryKey: scheduleKeys.exceptions,
    queryFn: () => api.get<ScheduleException[]>('/api/schedule-exceptions'),
  });
}

export function useCreateException() {
  const invalidate = useInvalidateSchedules();
  return useMutation({
    mutationFn: (data: ScheduleExceptionCreate) =>
      api.post<ScheduleException>('/api/schedule-exceptions', data),
    onSuccess: invalidate,
  });
}

export function useDeleteException() {
  const invalidate = useInvalidateSchedules();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/schedule-exceptions/${id}`),
    onSuccess: invalidate,
  });
}

export function useScheduleRuns(q: { scheduleId?: number; page: number }) {
  return useQuery({
    queryKey: scheduleKeys.runs(q),
    queryFn: () =>
      api.get<Page<ScheduleRun>>('/api/schedule-runs', { query: { ...q, pageSize: 50 } }),
  });
}

export function usePauseScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SchedulerPauseInput) =>
      api.post<SchedulerPause>('/api/scheduler/pause', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.dashboard }),
  });
}

export function useResumeScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/scheduler/resume'),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.dashboard }),
  });
}

export function useAcknowledgeNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/api/notices/${id}/ack`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.dashboard }),
  });
}
