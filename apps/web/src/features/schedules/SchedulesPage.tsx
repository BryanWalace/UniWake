import { useState } from 'react';
import type { Schedule } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { FormError } from '../../components/form';
import { Button, ConfirmDialog, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useDeleteSchedule, useNextRuns, useSchedules, useSaveSchedule } from './api';
import { weekdaysLabel } from './format';
import { ScheduleFormDialog } from './ScheduleFormDialog';

const DEFAULT_TZ = 'America/Sao_Paulo';

/** Agendamentos (FR-005.1, FR-005.8). */
export function SchedulesPage({ extra }: { extra?: React.ReactNode }) {
  const schedules = useSchedules();
  const remove = useDeleteSchedule();
  const save = useSaveSchedule();
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(s: Schedule) {
    setError(null);
    try {
      await save.mutateAsync({ id: s.id, data: { enabled: !s.enabled } });
      setMessage(`"${s.name}" ${s.enabled ? 'desativado' : 'ativado'}.`);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Agendamentos"
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            Novo agendamento
          </Button>
        }
      />
      {message && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm">
          {message}
        </p>
      )}
      <FormError message={error} />
      {schedules.isPending ? (
        <LoadingState />
      ) : schedules.isError ? (
        <ErrorState message={schedules.error.message} onRetry={() => void schedules.refetch()} />
      ) : schedules.data.length === 0 ? (
        <EmptyState title="Nenhum agendamento">
          Crie um agendamento para ligar as salas automaticamente antes das aulas.
        </EmptyState>
      ) : (
        <ul className="space-y-3" aria-label="Agendamentos">
          {schedules.data.map((s) => (
            <ScheduleRow
              key={s.id}
              s={s}
              onEdit={() => setEditing(s)}
              onDelete={() => setDeleting(s)}
              onToggle={() => void toggle(s)}
            />
          ))}
        </ul>
      )}
      {extra}
      <ScheduleFormDialog
        open={editing !== null}
        schedule={editing === 'new' || editing === null ? undefined : editing}
        defaultTimezone={DEFAULT_TZ}
        onClose={() => setEditing(null)}
        onSaved={(s) => {
          setEditing(null);
          setMessage(`Agendamento "${s.name}" salvo.`);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Excluir agendamento"
        confirmLabel="Excluir"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const s = deleting!;
          setDeleting(null);
          remove.mutate(s.id, {
            onSuccess: () => setMessage(`Agendamento "${s.name}" excluído.`),
            onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.'),
          });
        }}
      >
        <p>
          Excluir <strong>{deleting?.name}</strong>? O histórico de execuções também será removido.
        </p>
      </ConfirmDialog>
    </section>
  );
}

function ScheduleRow({
  s,
  onEdit,
  onDelete,
  onToggle,
}: {
  s: Schedule;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const next = useNextRuns(s.id, open);
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-56 flex-1">
          <h2 className="text-lg font-bold">
            {s.name}{' '}
            {!s.enabled && (
              <span className="rounded bg-slate-200 px-1.5 text-xs font-semibold text-slate-800">
                inativo
              </span>
            )}
          </h2>
          <p className="text-sm text-slate-700">
            {weekdaysLabel(s.weekdays)} às {s.timeLocal}
            {s.timezone !== DEFAULT_TZ && ` (${s.timezone})`} · {s.targetLabel}
            {s.onlyOffline && ' · só as desligadas'}
          </p>
          {s.emptyTarget ? (
            <p className="mt-1 text-sm font-semibold text-red-800">
              Alvo vazio: nenhuma máquina corresponde. Edite o alvo, senão a próxima execução vai
              falhar.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              {s.targetCount} máquina(s) ·{' '}
              {s.nextRun === null
                ? 'sem próxima execução'
                : `próxima: ${formatDateTime(s.nextRun)}`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onToggle} aria-label={`${s.enabled ? 'Desativar' : 'Ativar'} ${s.name}`}>
            {s.enabled ? 'Desativar' : 'Ativar'}
          </Button>
          <Button onClick={onEdit} aria-label={`Editar ${s.name}`}>
            Editar
          </Button>
          <Button variant="danger" onClick={onDelete} aria-label={`Excluir ${s.name}`}>
            Excluir
          </Button>
        </div>
      </div>
      <details
        className="mt-2 text-sm"
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-blue-800">Próximas 5 execuções</summary>
        {next.isPending ? (
          <LoadingState />
        ) : (
          <ol className="mt-1 list-decimal pl-6">
            {(next.data ?? []).map((r) => (
              <li key={r.at}>{formatDateTime(r.at)}</li>
            ))}
          </ol>
        )}
      </details>
    </li>
  );
}
