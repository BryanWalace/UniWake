import type { Device } from '@uniwake/shared';
import type { RoomWithCount, TagWithCount } from '../../api/hooks';
import { Button, StatusBadge, TagChip } from '../../components/ui';

interface Props {
  devices: Device[];
  rooms: RoomWithCount[];
  tags: TagWithCount[];
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onToggleAll: (ids: number[], select: boolean) => void;
  onEdit: (device: Device) => void;
  showRoom?: boolean;
}

export function DevicesTable({
  devices,
  rooms,
  tags,
  selected,
  onToggle,
  onToggleAll,
  onEdit,
  showRoom = true,
}: Props) {
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const ids = devices.map((d) => d.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <caption className="sr-only">Dispositivos</caption>
        <thead className="bg-slate-50 text-left text-slate-700">
          <tr>
            <th scope="col" className="w-10 px-3 py-2">
              <input
                type="checkbox"
                aria-label="Selecionar todos desta página"
                checked={allSelected}
                onChange={(e) => onToggleAll(ids, e.target.checked)}
              />
            </th>
            <th scope="col" className="px-3 py-2">
              Nome
            </th>
            <th scope="col" className="px-3 py-2">
              Status
            </th>
            <th scope="col" className="px-3 py-2">
              IP
            </th>
            <th scope="col" className="px-3 py-2">
              MAC
            </th>
            {showRoom && (
              <th scope="col" className="px-3 py-2">
                Sala
              </th>
            )}
            <th scope="col" className="px-3 py-2">
              Etiquetas
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {devices.map((d) => (
            <tr key={d.id} className={d.enabled ? '' : 'text-slate-500'}>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`Selecionar ${d.name}`}
                  checked={selected.has(d.id)}
                  onChange={() => onToggle(d.id)}
                />
              </td>
              <td className="px-3 py-2 font-medium">
                {d.name}
                {!d.enabled && <span className="ml-2 text-xs">(inativo)</span>}
                {d.flags.macLocallyAdministered && (
                  <span
                    className="ml-2 text-xs text-amber-800"
                    title="MAC de Wi-Fi, virtual ou aleatório"
                  >
                    ⚠ MAC suspeito
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={d.status} />
              </td>
              <td className="px-3 py-2 font-mono">{d.ip ?? '—'}</td>
              <td className="px-3 py-2 font-mono">{d.mac}</td>
              {showRoom && (
                <td className="px-3 py-2">
                  {d.roomId === null ? 'Sem sala' : roomName.get(d.roomId)}
                </td>
              )}
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {d.tagIds.map((id) => {
                    const t = tagById.get(id);
                    return t ? <TagChip key={id} name={t.name} color={t.color} /> : null;
                  })}
                </div>
              </td>
              <td className="px-3 py-2 text-right">
                <Button variant="ghost" onClick={() => onEdit(d)} aria-label={`Editar ${d.name}`}>
                  Editar
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
