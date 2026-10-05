import { type FormEvent, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { ErrorState, LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { type Backup, useBackups, useCreateBackup, useRestoreBackup } from './api';

const KIND_TEXT: Record<Backup['kind'], string> = {
  daily: 'diário',
  manual: 'manual',
  'pre-migration': 'antes de atualizar o banco',
  'pre-update': 'antes de atualizar o UniWake',
  'pre-restore': 'antes de restaurar',
};

/** Backups (FR-014): list, create now, restore with typed confirmation. */
export function BackupsSection() {
  const backups = useBackups();
  const create = useCreateBackup();
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <section aria-labelledby="backups" className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="backups" className="text-lg font-bold">
          Backups do banco de dados
        </h2>
        <Button
          onClick={() =>
            create.mutate(undefined, { onSuccess: () => setMessage('Backup criado.') })
          }
          disabled={create.isPending}
        >
          Criar backup agora
        </Button>
      </div>
      {message && (
        <p role="status" className="mb-2 text-sm text-green-800">
          {message}
        </p>
      )}
      {backups.isPending ? (
        <LoadingState />
      ) : backups.isError ? (
        <ErrorState message={backups.error.message} onRetry={() => void backups.refetch()} />
      ) : backups.data.length === 0 ? (
        <p className="text-sm text-slate-700">Nenhum backup ainda.</p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="Backups">
          {backups.data.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="w-40">{formatDateTime(b.createdAt)}</span>
              <span className="flex-1">{KIND_TEXT[b.kind]}</span>
              <span className="text-slate-600">{(b.size / 1024 / 1024).toFixed(1)} MB</span>
              <Button
                variant="ghost"
                aria-label={`Restaurar backup de ${formatDateTime(b.createdAt)}`}
                onClick={() => setRestoring(b)}
              >
                Restaurar
              </Button>
            </li>
          ))}
        </ul>
      )}
      {restoring && <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} />}
    </section>
  );
}

function RestoreDialog({ backup, onClose }: { backup: Backup; onClose: () => void }) {
  const restore = useRestoreBackup();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await restore.mutateAsync({ id: backup.id, confirm });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
    }
  }

  return (
    <Dialog
      open
      title="Restaurar backup"
      onClose={onClose}
      footer={
        done ? null : (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="danger" type="submit" form="restore-form" disabled={restore.isPending}>
              Restaurar e reiniciar
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p role="status">
          O UniWake está reiniciando com o backup restaurado. Recarregue esta página em cerca de um
          minuto.
        </p>
      ) : (
        <form id="restore-form" onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
          <p className="text-sm">
            Tudo o que mudou depois de <strong>{formatDateTime(backup.createdAt)}</strong> será
            desfeito. Antes, o estado atual é salvo num backup "antes de restaurar". O serviço
            reinicia em seguida.
          </p>
          <FormError message={error} />
          <TextField
            label={`Para confirmar, digite a data do backup: ${backup.dateLabel}`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
          />
        </form>
      )}
    </Dialog>
  );
}
