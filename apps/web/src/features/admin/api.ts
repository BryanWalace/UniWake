/** Users, audit, settings, network preview and own password (FR-006, FR-011, FR-016). */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditRow,
  Page,
  Settings,
  SettingKey,
  User,
  UserCreate,
  UserUpdate,
} from '@uniwake/shared';
import { api } from '../../api/client';

export interface SettingsView {
  values: Settings;
  pendingRestart: SettingKey[];
}

export interface NetworkPreview {
  interfaces: {
    name: string;
    address: string;
    prefixLength: number;
    gateway: string | null;
    mac: string;
    selected: boolean;
    reason: string | null;
  }[];
  ports: number[];
  repeat: number;
  destinations: { sourceIp: string; destination: string }[];
  rooms: {
    roomId: number;
    name: string;
    destinations: { sourceIp: string; destination: string }[];
  }[];
}

export interface AuditFilters {
  action?: string;
  result?: 'ok' | 'error' | 'denied';
  q?: string;
  from?: number;
  to?: number;
}

export const adminKeys = {
  users: ['users'] as const,
  audit: (f: AuditFilters, page: number) => ['audit', f, page] as const,
  settings: ['settings'] as const,
  network: ['network'] as const,
};

export function useUsers() {
  return useQuery({ queryKey: adminKeys.users, queryFn: () => api.get<User[]>('/api/users') });
}

export function useSaveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: UserCreate | UserUpdate }) =>
      id === undefined
        ? api.post<User>('/api/users', data)
        : api.patch<User>(`/api/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.users }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      api.post(`/api/users/${id}/reset-password`, { newPassword }),
  });
}

export function useChangeOwnPassword() {
  return useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.post('/api/auth/password', data),
  });
}

/** Query string of the audit filters (also used for the CSV export link). */
export function auditQuery(f: AuditFilters): Record<string, string | number | undefined> {
  return {
    action: f.action || undefined,
    result: f.result,
    q: f.q || undefined,
    from: f.from,
    to: f.to,
  };
}

export function useAudit(f: AuditFilters, page: number) {
  return useQuery({
    queryKey: adminKeys.audit(f, page),
    queryFn: () =>
      api.get<Page<AuditRow>>('/api/audit', { query: { ...auditQuery(f), page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => api.get<SettingsView>('/api/settings'),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Record<SettingKey, unknown>>) =>
      api.patch<{ changes: { key: SettingKey }[]; restartRequired: SettingKey[] }>(
        '/api/settings',
        patch,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.settings }),
  });
}

export function useNetworkPreview() {
  return useQuery({
    queryKey: adminKeys.network,
    queryFn: () => api.get<NetworkPreview>('/api/network/interfaces'),
  });
}

export function useUploadCertificate() {
  return useMutation({
    mutationFn: (data: { pfxBase64: string; password: string }) =>
      api.post<{ restartRequired: boolean }>('/api/settings/certificate', data),
  });
}

export interface Backup {
  id: number;
  file: string;
  kind: 'daily' | 'pre-migration' | 'pre-update' | 'pre-restore' | 'pre-join' | 'manual';
  createdAt: number;
  size: number;
  dateLabel: string;
}

export function useBackups() {
  return useQuery({ queryKey: ['backups'], queryFn: () => api.get<Backup[]>('/api/backups') });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Backup>('/api/backups'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });
}

export function useRestoreBackup() {
  return useMutation({
    mutationFn: ({ id, confirm }: { id: number; confirm: string }) =>
      api.post<{ restarting: true }>(`/api/backups/${id}/restore`, { confirm }),
  });
}
