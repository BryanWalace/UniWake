import { type FormEvent, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { ErrorState, LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, PageHeader, SelectField } from '../../components/ui';
import { useCreateException, useDeleteException, useExceptions, useSchedules } from './api';

const br = (d: string) => d.split('-').reverse().join('/');

/** Holidays and recesses (FR-005.2): every schedule, or just one. */
export function ExceptionsSection() {
  const exceptions = useExceptions();
  const schedules = useSchedules();
  const create = useCreateException();
  const remove = useDeleteException();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const names = new Map((schedules.data ?? []).map((s) => [s.id, s.name]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      await create.mutateAsync({
        startDate,
        ...(endDate ? { endDate } : {}),
        description,
        scheduleId: scheduleId === '' ? null : Number(scheduleId),
      });
      setStartDate('');
      setEndDate('');
      setDescription('');
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.code === 'VALIDATION_FAILED' &&
        Array.isArray(err.details)
      ) {
        const next: Record<string, string> = {};
        for (const d of err.details as { path?: string; message?: string }[]) {
          next[(d.path ?? '').split('.')[0] ?? ''] ??= d.message ?? 'Valor inválido.';
        }
        return setErrors(next);
      }
      setFormError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
    }
  }

  return (
    <section aria-label="Feriados e recessos" className="space-y-3">
      <PageHeader level={2} title="Feriados e recessos" />
      <p className="-mt-3 text-sm text-slate-600">
        Nesses dias os agendamentos não ligam nada; a execução fica registrada como "pulado
        (feriado)".
      </p>
      {exceptions.isPending ? (
        <LoadingState />
      ) : exceptions.isError ? (
        <ErrorState message={exceptions.error.message} onRetry={() => void exceptions.refetch()} />
      ) : exceptions.data.length === 0 ? (
        <p className="text-sm text-slate-700">Nenhum feriado cadastrado.</p>
      ) : (
        <ul
          className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white"
          aria-label="Feriados"
        >
          {exceptions.data.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
              <span className="w-48 font-mono">
                {x.startDate === x.endDate
                  ? br(x.startDate)
                  : `${br(x.startDate)} a ${br(x.endDate)}`}
              </span>
              <span className="flex-1 font-medium">{x.description}</span>
              <span className="text-slate-600">
                {x.scheduleId === null
                  ? 'Todos os agendamentos'
                  : (names.get(x.scheduleId) ?? 'Agendamento')}
              </span>
              <Button
                variant="ghost"
                aria-label={`Excluir ${x.description}`}
                onClick={() => remove.mutate(x.id)}
              >
                Excluir
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => void submit(e)}
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
        aria-label="Novo feriado"
        noValidate
      >
        <FormError message={formError} />
        <TextField
          label="Início"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          error={errors.startDate}
          required
        />
        <TextField
          label="Fim (opcional)"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          error={errors.endDate}
        />
        <TextField
          label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
          maxLength={100}
          placeholder="Ex.: Consciência Negra"
          required
        />
        <SelectField
          label="Vale para"
          value={scheduleId}
          onChange={(e) => setScheduleId(e.target.value)}
        >
          <option value="">Todos os agendamentos</option>
          {(schedules.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end">
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Adicionar
          </Button>
        </div>
      </form>
    </section>
  );
}
