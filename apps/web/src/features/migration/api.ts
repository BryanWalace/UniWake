import { useQuery } from '@tanstack/react-query';
import type {
  ExportRequest,
  ImportInspect,
  ImportMode,
  ImportPreview,
  MigrationState,
} from '@uniwake/shared';
import { api, postFile, postForFile } from '../../api/client';

export const migrationStateKey = ['migration', 'state'] as const;

export function useMigrationState() {
  return useQuery({
    queryKey: migrationStateKey,
    queryFn: () => api.get<MigrationState>('/api/migration/state'),
  });
}

export const exportFile = (req: ExportRequest) => postForFile('/api/migration/export', req);
export const inspectFile = (file: File) => postFile<ImportInspect>('/api/migration/import', file);
export const previewImport = (id: string, body: { mode: ImportMode; password?: string }) =>
  api.post<ImportPreview>(`/api/migration/import/${id}/preview`, body);
export const applyImport = (id: string, body: { mode: ImportMode; password?: string }) =>
  api.post<ImportPreview>(`/api/migration/import/${id}/apply`, { ...body, confirm: 'IMPORTAR' });
export const activateStandby = () =>
  api.post<void>('/api/migration/standby/activate', { confirm: 'ATIVAR' });
export const undoImport = () =>
  api.post<{ restarting: true }>('/api/migration/undo', { confirm: 'DESFAZER' });

/** Saves a downloaded file through a temporary link (the browser shows its usual download). */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
