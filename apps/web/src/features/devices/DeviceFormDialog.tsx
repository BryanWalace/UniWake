import { type FormEvent, useState } from 'react';
import type { Device, DeviceSaveResult } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { useRooms, useSaveDevice, useTags } from '../../api/hooks';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog, SelectField } from '../../components/ui';

export const WARNING_TEXT: Record<DeviceSaveResult['warnings'][number], string> = {
  duplicate_name: 'Já existe outro dispositivo com este nome.',
  mac_locally_administered:
    'Este MAC parece ser de Wi-Fi, máquina virtual ou aleatório. O Wake-on-LAN normalmente só funciona com o MAC da placa de rede cabeada.',
};

interface Props {
  open: boolean;
  device?: Device | undefined;
  defaultRoomId?: number | null;
  onClose: () => void;
  onSaved: (result: DeviceSaveResult) => void;
}

type Errors = Partial<
  Record<'name' | 'mac' | 'ip' | 'hostname' | 'roomId' | 'tagIds' | 'notes', string>
>;

/** Create/edit device (FR-002.1). Server errors map back to fields. */
export function DeviceFormDialog(props: Props) {
  // Mount a fresh form every time the dialog opens, so its state starts from the props.
  if (!props.open) return null;
  return <DeviceFormDialogBody key={props.device?.id ?? 'new'} {...props} />;
}

function DeviceFormDialogBody({ open, device, defaultRoomId = null, onClose, onSaved }: Props) {
  const rooms = useRooms();
  const tags = useTags();
  const save = useSaveDevice();
  const [name, setName] = useState(device?.name ?? '');
  const [mac, setMac] = useState(device?.mac ?? '');
  const [ip, setIp] = useState(device?.ip ?? '');
  const [hostname, setHostname] = useState(device?.hostname ?? '');
  const [roomId, setRoomId] = useState<string>(
    String(device ? (device.roomId ?? '') : (defaultRoomId ?? '')),
  );
  const [tagIds, setTagIds] = useState<number[]>(device?.tagIds ?? []);
  const [notes, setNotes] = useState(device?.notes ?? '');
  const [enabled, setEnabled] = useState(device?.enabled ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      const result = await save.mutateAsync({
        id: device?.id,
        data: {
          name,
          mac,
          ip,
          hostname,
          roomId: roomId === '' ? null : Number(roomId),
          tagIds,
          notes,
          enabled,
        },
      });
      onSaved(result);
    } catch (err) {
      if (!(err instanceof ApiRequestError)) {
        setFormError('Erro inesperado.');
        return;
      }
      if (err.code === 'DEVICE_MAC_DUPLICATE') {
        setErrors({ mac: err.message });
        return;
      }
      if (err.code === 'VALIDATION_FAILED' && Array.isArray(err.details)) {
        const next: Errors = {};
        for (const d of err.details as { path?: string; message?: string }[]) {
          const key = (d.path ?? '').split('.')[0] as keyof Errors;
          if (key) next[key] = d.message ?? 'Valor inválido.';
        }
        setErrors(next);
        setFormError('Corrija os campos destacados.');
        return;
      }
      setFormError(err.message);
    }
  }

  const toggleTag = (id: number) =>
    setTagIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Dialog
      open={open}
      title={device ? `Editar ${device.name}` : 'Novo dispositivo'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="device-form" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id="device-form" onSubmit={(e) => void onSubmit(e)} className="space-y-3" noValidate>
        <FormError message={formError} />
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          required
          maxLength={64}
        />
        <TextField
          label="MAC (placa cabeada)"
          value={mac}
          onChange={(e) => setMac(e.target.value)}
          error={errors.mac}
          required
          hint="Aceita AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF ou AABBCCDDEEFF."
          autoComplete="off"
          spellCheck={false}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="IP"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            error={errors.ip}
            inputMode="decimal"
          />
          <TextField
            label="Nome de host"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            error={errors.hostname}
          />
        </div>
        <SelectField label="Sala" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Sem sala</option>
          {rooms.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        {tags.data && tags.data.length > 0 && (
          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Etiquetas</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {tags.data.map((t) => (
                <label key={t.id} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tagIds.includes(t.id)}
                    onChange={() => toggleTag(t.id)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <TextField
          label="Observações"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={errors.notes}
          maxLength={1000}
        />
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Ativo (incluído nas ligações e no monitoramento)
        </label>
      </form>
    </Dialog>
  );
}
