/** Query keys and hooks for rooms, tags and devices. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Device,
  DeviceBulk,
  DeviceCreate,
  DeviceSaveResult,
  DeviceStatus,
  DeviceUpdate,
  Page,
  Room,
  RoomCreate,
  RoomDeleteImpact,
  RoomUpdate,
  Tag,
  TagCreate,
  TagUpdate,
} from '@uniwake/shared';
import { api } from './client';

export type RoomWithCount = Room & { deviceCount: number };
export type TagWithCount = Required<Tag>;

export const keys = {
  me: ['auth', 'me'] as const,
  rooms: ['rooms'] as const,
  room: (id: number) => ['rooms', id] as const,
  tags: ['tags'] as const,
  devices: (params: DeviceQueryParams) => ['devices', params] as const,
  devicesAll: ['devices'] as const,
  dashboard: ['dashboard'] as const,
  uptime: (q: { deviceId?: number; roomId?: number; days: number }) => ['uptime', q] as const,
};

export interface DeviceQueryParams {
  roomId?: number | 'none';
  tagId?: number;
  status?: DeviceStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function useRooms() {
  return useQuery({ queryKey: keys.rooms, queryFn: () => api.get<RoomWithCount[]>('/api/rooms') });
}

export function useRoom(id: number) {
  return useQuery({
    queryKey: keys.room(id),
    queryFn: () => api.get<RoomWithCount>(`/api/rooms/${id}`),
  });
}

export function useTags() {
  return useQuery({ queryKey: keys.tags, queryFn: () => api.get<TagWithCount[]>('/api/tags') });
}

export function useDevice(id: number) {
  return useQuery({
    queryKey: ['devices', 'one', id] as const,
    queryFn: () => api.get<Device>(`/api/devices/${id}`),
  });
}

export function useDevices(params: DeviceQueryParams) {
  return useQuery({
    queryKey: keys.devices(params),
    queryFn: () =>
      api.get<Page<Device>>('/api/devices', {
        query: { ...params, roomId: params.roomId, q: params.q || undefined },
      }),
    placeholderData: keepPreviousData,
  });
}

/** After any device/room/tag change, counts and lists elsewhere must refresh. */
function useInvalidateInventory() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.devicesAll }),
      qc.invalidateQueries({ queryKey: keys.rooms }),
      qc.invalidateQueries({ queryKey: keys.tags }),
      qc.invalidateQueries({ queryKey: keys.dashboard }),
    ]);
}

export function useSaveDevice() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: DeviceCreate | DeviceUpdate }) =>
      id === undefined
        ? api.post<DeviceSaveResult>('/api/devices', data)
        : api.patch<DeviceSaveResult>(`/api/devices/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useBulkDevices() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (data: DeviceBulk) => api.post<{ affected: number }>('/api/devices/bulk', data),
    onSuccess: invalidate,
  });
}

export function useSaveRoom() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: RoomCreate | RoomUpdate }) =>
      id === undefined
        ? api.post<RoomWithCount>('/api/rooms', data)
        : api.patch<RoomWithCount>(`/api/rooms/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteRoom() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, confirm }: { id: number; confirm: boolean }) =>
      api.del(`/api/rooms/${id}`, { query: { confirm: confirm || undefined } }),
    onSuccess: invalidate,
  });
}

export function roomDeleteImpact(id: number) {
  return api.get<RoomDeleteImpact>(`/api/rooms/${id}/delete-impact`);
}

export function useSaveTag() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: TagCreate | TagUpdate }) =>
      id === undefined
        ? api.post<TagWithCount>('/api/tags', data)
        : api.patch<TagWithCount>(`/api/tags/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteTag() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, confirm }: { id: number; confirm: boolean }) =>
      api.del(`/api/tags/${id}`, { query: { confirm: confirm || undefined } }),
    onSuccess: invalidate,
  });
}

export function tagDeleteImpact(id: number) {
  return api.get<RoomDeleteImpact>(`/api/tags/${id}/delete-impact`);
}
