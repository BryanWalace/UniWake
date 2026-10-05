import { type FormEvent, useState } from 'react';
import {
  type Schedule,
  type ScheduleCreate,
  WEEKDAY_LABELS,
  type WakeTarget,
} from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog, SelectField } from '../../components/ui';
import { useSaveSchedule } from './api';
import { TIMEZONES } from './format';
import { TargetPicker } from './TargetPicker';

type Field = 'name' | 'weekdays' | 'timeLocal' | 'timezone' | 'target' | 'stagger';

interface Props {
  open: boolean;
  schedule?: Schedule | undefined;
  onClose: () => void;
  onSaved: (s: Schedule) => void;
}

/** Create/edit schedule (FR-005.1). Mounted fresh on every open. */
export function ScheduleFormDialog(props: Props) {
  if (!props.open) return null;
  return <ScheduleFormBody key={props.schedule?.id ?? 'new'} {...props} />;
}

function ScheduleFormBody({ schedule, onClose, onSaved }: Props) {
  const save = useSaveSchedule();
  const [name, setName] = useState(schedule?.name ?? '');
  const [weekdays, setWeekdays] = useState(schedule?.weekdays ?? 31);
  const [timeLocal, setTimeLocal] = useState(schedule?.timeLocal ?? '06:50');
  // '' = the hub's zone (scheduler.timezone), applied by the server (R-M6-01).
  const [timezone, setTimezone] = useState(schedule?.timezone ?? '');
  const [target, setTarget] = useState<WakeTarget>(
    schedule?.target ?? { type: 'rooms', roomIds: [], includeNoRoom: false },
  );
  const [onlyOffline, setOnlyOffline] = useState(schedule?.onlyOffline ?? false);
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [batchSize, setBatchSize] = useState(schedule?.stagger?.batchSize.toString() ?? '');
  const [batchDelay, setBatchDelay] = useState(
    schedule?.stagger?.batchDelaySeconds.toString() ?? '',
  );
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** SR-10: the server asked to confirm this many machines. */
  const [confirmCount, setConfirmCount] = useState<number | null>(null);

  const zones =
    timezone === '' || TIMEZONES.includes(timezone as (typeof TIMEZONES)[number])
      ? TIMEZONES
      : [timezone, ...TIMEZONES];

  async function submit(confirm?: number) {
    setErrors({});
    setFormError(null);
    const stagger =
      batchSize.trim() === '' && batchDelay.trim() === ''
        ? null
        : { batchSize: Number(batchSize || 10), batchDelaySeconds: Number(batchDelay || 5) };
    const data: ScheduleCreate = {
      name,
      enabled,
      weekdays,
      timeLocal,
      ...(timezone !== '' ? { timezone } : {}),
      target,
      onlyOffline,
      stagger,
      ...(confirm !== undefined ? { confirm: { count: confirm } } : {}),
    };
    try {
      onSaved(await save.mutateAsync({ id: schedule?.id, data }));
    } catch (err) {
      if (!(err instanceof ApiRequestError)) return setFormError('Erro inesperado.');
      if (err.code === 'CONFIRMATION_REQUIRED') {
        return setConfirmCount((err.details as { count: number }).count);
      }
      if (err.code === 'TARGET_NOT_FOUND') return setErrors({ target: err.message });
      if (err.code === 'VALIDATION_FAILED' && Array.isArray(err.details)) {
        const next: Partial<Record<Field, string>> = {};
        for (const d of err.details as { path?: string; message?: string }[]) {
          const key = (d.path ?? '').split('.')[0] as Field;
          if (key) next[key] ??= d.message ?? 'Valor inválido.';
        }
        setErrors(next);
        if (Object.keys(next).length > 0) return;
      }
      setFormError(err.message);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  return (
    <Dialog
      open
      wide
      title={schedule ? `Editar ${schedule.name}` : 'Novo agendamento'}
      onClose={onClose}
      footer={
        confirmCount === null ? (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" type="submit" form="schedule-form" disabled={save.isPending}>
              Salvar
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setConfirmCount(null)}>Voltar</Button>
            <Button
              variant="primary"
              onClick={() => void submit(confirmCount)}
              disabled={save.isPending}
            >
              Confirmar: {confirmCount} máquinas
            </Button>
          </>
        )
      }
    >
      {confirmCount !== null ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="font-semibold">
            Este agendamento liga {confirmCount} máquinas a cada execução.
          </p>
          <p>
            É uma ação grande. Confirme uma vez agora; nas execuções automáticas não será preciso
            confirmar de novo.
          </p>
        </div>
      ) : (
        <form id="schedule-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <TextField
            label="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            maxLength={64}
            required
          />
          <fieldset aria-describedby={errors.weekdays ? 'weekdays-error' : undefined}>
            <legend className="text-sm font-medium text-slate-800">Dias da semana</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {WEEKDAY_LABELS.map((label, i) => (
                <label key={label} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={(weekdays & (1 << i)) !== 0}
                    onChange={() => setWeekdays((w) => w ^ (1 << i))}
                  />
                  {label}
                </label>
              ))}
              <Button variant="ghost" onClick={() => setWeekdays(31)}>
                Seg a Sex
              </Button>
              <Button variant="ghost" onClick={() => setWeekdays(127)}>
                Todos os dias
              </Button>
            </div>
            {errors.weekdays && (
              <p id="weekdays-error" className="mt-1 text-sm text-red-700">
                {errors.weekdays}
              </p>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Horário"
              type="time"
              value={timeLocal}
              onChange={(e) => setTimeLocal(e.target.value)}
              error={errors.timeLocal}
              required
            />
            <SelectField
              label="Fuso horário"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              <option value="">Fuso do UniWake (padrão)</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace('America/', '').replace('_', ' ')}
                </option>
              ))}
            </SelectField>
          </div>
          <TargetPicker value={target} onChange={setTarget} error={errors.target} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyOffline}
              onChange={(e) => setOnlyOffline(e.target.checked)}
            />
            Ligar só as que estiverem desligadas
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Escalonamento (opcional)</summary>
            <p className="mt-1 text-slate-600">
              Deixe em branco para usar o padrão de cada sala. Útil para não sobrecarregar o
              disjuntor.
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <TextField
                label="Máquinas por lote"
                type="number"
                min={1}
                max={500}
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
                error={errors.stagger}
              />
              <TextField
                label="Segundos entre lotes"
                type="number"
                min={0}
                max={600}
                value={batchDelay}
                onChange={(e) => setBatchDelay(e.target.value)}
              />
            </div>
          </details>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Ativo
          </label>
        </form>
      )}
    </Dialog>
  );
}
