import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { DeviceCompact, WakeTarget } from '@uniwake/shared';
import { api } from '../../api/client';
import { useRooms, useTags } from '../../api/hooks';
import { LoadingState } from '../../components/Banner';
import { TagChip } from '../../components/ui';
import { fold } from '../wake/QuickWake';

const KINDS: { type: WakeTarget['type']; label: string }[] = [
  { type: 'rooms', label: 'Salas' },
  { type: 'tags', label: 'Etiquetas' },
  { type: 'devices', label: 'Máquinas' },
  { type: 'all', label: 'Todas as máquinas' },
];

const empty = (type: WakeTarget['type']): WakeTarget => {
  switch (type) {
    case 'rooms':
      return { type, roomIds: [], includeNoRoom: false };
    case 'tags':
      return { type, tagIds: [] };
    case 'devices':
      return { type, deviceIds: [] };
    case 'all':
      return { type };
  }
};

const toggle = (list: number[], id: number) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** Picks what a schedule wakes: rooms (and "Sem sala"), tags, machines or everything. */
export function TargetPicker({
  value,
  onChange,
  error,
}: {
  value: WakeTarget;
  onChange: (t: WakeTarget) => void;
  error?: string | undefined;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-3" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="text-sm font-medium text-slate-800">O que ligar</legend>
      <div className="flex flex-wrap gap-3">
        {KINDS.map((k) => (
          <label key={k.type} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={name}
              checked={value.type === k.type}
              onChange={() => onChange(empty(k.type))}
            />
            {k.label}
          </label>
        ))}
      </div>
      {value.type === 'rooms' && <RoomChoice value={value} onChange={onChange} />}
      {value.type === 'tags' && <TagChoice value={value} onChange={onChange} />}
      {value.type === 'devices' && <DeviceChoice value={value} onChange={onChange} />}
      {value.type === 'all' && (
        <p className="text-sm text-slate-700">Todas as máquinas ativas, de todas as salas.</p>
      )}
      {error && (
        <p id={`${name}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function RoomChoice({
  value,
  onChange,
}: {
  value: Extract<WakeTarget, { type: 'rooms' }>;
  onChange: (t: WakeTarget) => void;
}) {
  const rooms = useRooms();
  if (rooms.isPending) return <LoadingState />;
  return (
    <ul className="grid gap-1 sm:grid-cols-2" aria-label="Salas">
      {(rooms.data ?? []).map((r) => (
        <li key={r.id}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.roomIds.includes(r.id)}
              onChange={() => onChange({ ...value, roomIds: toggle(value.roomIds, r.id) })}
            />
            {r.name} <span className="text-slate-600">({r.deviceCount})</span>
          </label>
        </li>
      ))}
      <li>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includeNoRoom}
            onChange={() => onChange({ ...value, includeNoRoom: !value.includeNoRoom })}
          />
          Sem sala
        </label>
      </li>
    </ul>
  );
}

function TagChoice({
  value,
  onChange,
}: {
  value: Extract<WakeTarget, { type: 'tags' }>;
  onChange: (t: WakeTarget) => void;
}) {
  const tags = useTags();
  if (tags.isPending) return <LoadingState />;
  if ((tags.data ?? []).length === 0) {
    return <p className="text-sm text-slate-700">Nenhuma etiqueta cadastrada.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-3" aria-label="Etiquetas">
      {(tags.data ?? []).map((t) => (
        <li key={t.id}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.tagIds.includes(t.id)}
              onChange={() => onChange({ ...value, tagIds: toggle(value.tagIds, t.id) })}
            />
            <TagChip name={t.name} color={t.color} /> ({t.deviceCount})
          </label>
        </li>
      ))}
    </ul>
  );
}

function DeviceChoice({
  value,
  onChange,
}: {
  value: Extract<WakeTarget, { type: 'devices' }>;
  onChange: (t: WakeTarget) => void;
}) {
  const [q, setQ] = useState('');
  const devices = useQuery({
    queryKey: ['devices', 'compact'],
    queryFn: () => api.get<DeviceCompact[]>('/api/devices', { query: { all: 1 } }),
  });
  const all = devices.data ?? [];
  const byId = new Map(all.map((d) => [d.id, d]));
  const matches =
    q.trim() === ''
      ? []
      : all
          .filter((d) =>
            [d.name, d.ip ?? '', d.mac, d.hostname ?? ''].some((s) =>
              fold(s).includes(fold(q.trim())),
            ),
          )
          .filter((d) => !value.deviceIds.includes(d.id))
          .slice(0, 8);
  return (
    <div className="space-y-2">
      {value.deviceIds.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Máquinas escolhidas">
          {value.deviceIds.map((id) => (
            <li
              key={id}
              className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-sm"
            >
              {byId.get(id)?.name ?? `Máquina ${id}`}
              <button
                type="button"
                className="px-1 text-slate-600 hover:text-red-700"
                aria-label={`Remover ${byId.get(id)?.name ?? `máquina ${id}`}`}
                onClick={() =>
                  onChange({ ...value, deviceIds: value.deviceIds.filter((x) => x !== id) })
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="block text-sm">
        Adicionar máquina
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome, IP ou MAC"
          maxLength={100}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      {matches.length > 0 && (
        <ul
          className="divide-y divide-slate-100 rounded-md border border-slate-200"
          aria-label="Resultados"
        >
          {matches.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  onChange({ ...value, deviceIds: [...value.deviceIds, d.id] });
                  setQ('');
                }}
              >
                {d.name} <span className="text-slate-600">{d.ip ?? d.mac}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
