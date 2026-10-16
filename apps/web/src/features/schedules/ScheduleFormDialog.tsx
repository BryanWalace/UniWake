import { type FormEvent, useState } from 'react';
import {
  type Schedule,
  type ScheduleCreate,
  WEEKDAY_LABELS,
  type WakeTarget,
} from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { useTags } from '../../api/hooks';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog, SelectField } from '../../components/ui';
import { useSaveSchedule } from './api';
import { TIMEZONES } from './format';
import { TargetPicker } from './TargetPicker';
import { ShutdownReach } from '../power/ShutdownReach';

type Field = 'name' | 'weekdays' | 'timeLocal' | 'timezone' | 'target' | 'stagger' | 'power';

interface Props {
  open: boolean;
  schedule?: Schedule | undefined;
  onClose: () => void;
  onSaved: (s: Schedule) => void;
}

/** Create/edit schedule (FR-005.1, FR-306 "Ação: Ligar | Desligar"). Mounted fresh on every open. */
export function ScheduleFormDialog(props: Props) {
  if (!props.open) return null;
  return <ScheduleFormBody key={props.schedule?.id ?? 'new'} {...props} />;
}

function ScheduleFormBody({ schedule, onClose, onSaved }: Props) {
  const save = useSaveSchedule();
  const tags = useTags();
  const [action, setAction] = useState<'wake' | 'shutdown'>(schedule?.action ?? 'wake');
  // Blank = the "Desligar computadores" settings, filled in by the hub (FR-306.1).
  const [warning, setWarning] = useState(schedule?.power?.warningMinutes.toString() ?? '');
  const [allowPostpone, setAllowPostpone] = useState(schedule?.power?.allowPostpone ?? true);
  const [postponeMax, setPostponeMax] = useState(schedule?.power?.postponeMax.toString() ?? '');
  const [postponeMinutes, setPostponeMinutes] = useState(
    schedule?.power?.postponeMinutes.toString() ?? '',
  );
  const [excludeTagIds, setExcludeTagIds] = useState<number[]>(schedule?.excludeTagIds ?? []);
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
    const shutdown = action === 'shutdown';
    const power = {
      ...(warning.trim() !== '' ? { warningMinutes: Number(warning) } : {}),
      allowPostpone,
      ...(postponeMax.trim() !== '' ? { postponeMax: Number(postponeMax) } : {}),
      ...(postponeMinutes.trim() !== '' ? { postponeMinutes: Number(postponeMinutes) } : {}),
    };
    const data: ScheduleCreate = {
      name,
      enabled,
      weekdays,
      timeLocal,
      ...(timezone !== '' ? { timezone } : {}),
      target,
      action,
      onlyOffline: shutdown ? false : onlyOffline,
      stagger: shutdown ? null : stagger,
      ...(shutdown ? { power, excludeTagIds } : {}),
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
            Este agendamento {action === 'shutdown' ? 'desliga' : 'liga'} {confirmCount} máquinas a
            cada execução.
          </p>
          <p>
            É uma ação grande. Confirme uma vez agora; nas execuções automáticas não será preciso
            confirmar de novo.
          </p>
        </div>
      ) : (
        <form id="schedule-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Ação</legend>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="action"
                  checked={action === 'wake'}
                  onChange={() => setAction('wake')}
                />
                Ligar
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="action"
                  checked={action === 'shutdown'}
                  onChange={() => setAction('shutdown')}
                />
                Desligar
              </label>
            </div>
            {action === 'shutdown' && (
              <p className="mt-1 text-sm text-slate-600">
                Cada máquina preparada guarda este horário e desliga sozinha, mesmo com o UniWake
                desligado. Máquinas sem o novo preparo não desligam.
              </p>
            )}
          </fieldset>
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
          {action === 'shutdown' && <ShutdownReach target={target} />}
          {action === 'shutdown' ? (
            <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium text-slate-800">Aviso e adiamento</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  label="Aviso antes de desligar (min)"
                  type="number"
                  min={0}
                  max={30}
                  placeholder="padrão"
                  value={warning}
                  onChange={(e) => setWarning(e.target.value)}
                  error={errors.power}
                />
                <TextField
                  label="Quantas vezes pode adiar"
                  type="number"
                  min={0}
                  max={5}
                  placeholder="padrão"
                  value={postponeMax}
                  disabled={!allowPostpone}
                  onChange={(e) => setPostponeMax(e.target.value)}
                />
                <TextField
                  label="Minutos por adiamento"
                  type="number"
                  min={5}
                  max={60}
                  placeholder="padrão"
                  value={postponeMinutes}
                  disabled={!allowPostpone}
                  onChange={(e) => setPostponeMinutes(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowPostpone}
                  onChange={(e) => setAllowPostpone(e.target.checked)}
                />
                Permitir que o usuário adie
              </label>
              {(tags.data?.length ?? 0) > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    Não desligar máquinas com as etiquetas…
                  </p>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {tags.data!.map((t) => (
                      <label key={t.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={excludeTagIds.includes(t.id)}
                          onChange={() =>
                            setExcludeTagIds((ids) =>
                              ids.includes(t.id) ? ids.filter((x) => x !== t.id) : [...ids, t.id],
                            )
                          }
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-600">
                Em branco = padrão de Configurações › Desligar computadores. Máquinas marcadas
                "Nunca desligar por agendamento" também ficam de fora.
              </p>
            </fieldset>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyOffline}
                onChange={(e) => setOnlyOffline(e.target.checked)}
              />
              Ligar só as que estiverem desligadas
            </label>
          )}
          <details className="text-sm" hidden={action === 'shutdown'}>
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
