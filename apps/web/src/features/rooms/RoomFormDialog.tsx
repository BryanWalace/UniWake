import { type FormEvent, useState } from 'react';
import { DEFAULT_ROOM_COLOR } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { type RoomWithCount, useSaveRoom } from '../../api/hooks';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog } from '../../components/ui';

type Field =
  | 'name'
  | 'code'
  | 'block'
  | 'floor'
  | 'color'
  | 'notes'
  | 'batchSize'
  | 'batchDelaySeconds'
  | 'directedBroadcast';

interface Props {
  open: boolean;
  room?: RoomWithCount | undefined;
  onClose: () => void;
  onSaved: (room: RoomWithCount) => void;
}

/** Create/edit room (FR-008.1). Mounted fresh on every open. */
export function RoomFormDialog(props: Props) {
  if (!props.open) return null;
  return <RoomFormBody key={props.room?.id ?? 'new'} {...props} />;
}

const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

function RoomFormBody({ open, room, onClose, onSaved }: Props) {
  const save = useSaveRoom();
  const [v, setV] = useState<Record<Field, string>>({
    name: room?.name ?? '',
    code: room?.code ?? '',
    block: room?.block ?? '',
    floor: room?.floor ?? '',
    color: room?.color ?? DEFAULT_ROOM_COLOR,
    notes: room?.notes ?? '',
    batchSize: room?.batchSize?.toString() ?? '',
    batchDelaySeconds: room?.batchDelaySeconds?.toString() ?? '',
    directedBroadcast: room?.directedBroadcast ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (f: Field) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((cur) => ({ ...cur, [f]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      const saved = await save.mutateAsync({
        id: room?.id,
        data: {
          name: v.name,
          ...(v.code.trim() ? { code: v.code } : {}),
          block: v.block,
          floor: v.floor,
          color: v.color,
          notes: v.notes,
          batchSize: intOrNull(v.batchSize),
          batchDelaySeconds: intOrNull(v.batchDelaySeconds),
          directedBroadcast: v.directedBroadcast,
        },
      });
      onSaved(saved);
    } catch (err) {
      if (!(err instanceof ApiRequestError)) return setFormError('Erro inesperado.');
      if (err.code === 'ROOM_NAME_DUPLICATE') return setErrors({ name: err.message });
      if (err.code === 'ROOM_CODE_DUPLICATE') return setErrors({ code: err.message });
      if (err.code === 'VALIDATION_FAILED' && Array.isArray(err.details)) {
        const next: Partial<Record<Field, string>> = {};
        for (const d of err.details as { path?: string; message?: string }[]) {
          const key = (d.path ?? '').split('.')[0] as Field;
          if (key) next[key] = d.message ?? 'Valor inválido.';
        }
        setErrors(next);
        return setFormError('Corrija os campos destacados.');
      }
      setFormError(err.message);
    }
  }

  return (
    <Dialog
      open={open}
      title={room ? `Editar ${room.name}` : 'Nova sala'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="room-form" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id="room-form" onSubmit={(e) => void onSubmit(e)} className="space-y-3" noValidate>
        <FormError message={formError} />
        <TextField
          label="Nome"
          value={v.name}
          onChange={set('name')}
          error={errors.name}
          required
          maxLength={64}
        />
        <TextField
          label="Código da sala"
          value={v.code}
          onChange={set('code')}
          error={errors.code}
          hint={
            room
              ? 'Usado no cadastro automático das máquinas.'
              : 'Deixe vazio para gerar a partir do nome (ex.: LAB3).'
          }
          maxLength={16}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Bloco/prédio"
            value={v.block}
            onChange={set('block')}
            error={errors.block}
            maxLength={64}
          />
          <TextField
            label="Andar"
            value={v.floor}
            onChange={set('floor')}
            error={errors.floor}
            maxLength={32}
          />
          <TextField
            label="Cor"
            type="color"
            value={v.color}
            onChange={set('color')}
            error={errors.color}
          />
        </div>
        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium">Ligar aos poucos (opcional)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Máquinas por lote"
              type="number"
              min={1}
              max={500}
              value={v.batchSize}
              onChange={set('batchSize')}
              error={errors.batchSize}
              hint="Vazio = padrão do sistema."
            />
            <TextField
              label="Espera entre lotes (s)"
              type="number"
              min={0}
              max={600}
              value={v.batchDelaySeconds}
              onChange={set('batchDelaySeconds')}
              error={errors.batchDelaySeconds}
            />
          </div>
        </fieldset>
        <TextField
          label="Broadcast dirigido (rede de outra VLAN)"
          value={v.directedBroadcast}
          onChange={set('directedBroadcast')}
          error={errors.directedBroadcast}
          placeholder="ex.: 10.0.5.255"
          hint="Só se esta sala estiver em outra rede e o roteador permitir broadcast dirigido. Deixe vazio se estiver na mesma rede do UniWake."
        />
        <TextField
          label="Observações"
          value={v.notes}
          onChange={set('notes')}
          error={errors.notes}
          maxLength={1000}
        />
      </form>
    </Dialog>
  );
}
