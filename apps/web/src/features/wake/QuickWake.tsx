/**
 * Quick-wake palette (FR-004.7): Ctrl+K (⌘K) opens a searchable list of rooms, tags and devices;
 * Enter runs the normal preview → (confirmation) → wake flow, exactly like the room card buttons.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { useDevices, useRooms, useTags } from '../../api/hooks';
import { Dialog } from '../../components/ui';
import { useDebounced } from '../devices/DevicesPage';
import type { WakeIntent } from './WakeDialog';

interface Option {
  key: string;
  kind: 'Sala' | 'Etiqueta' | 'Máquina';
  label: string;
  detail: string;
  intent: WakeIntent;
}

/** Lower-case, accent-free text ("Laboratório" → "laboratorio"). */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Every query word must start some word of the text: "lab 3" matches "Laboratório 3". */
export function matches(text: string, query: string): boolean {
  const words = fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((q) => words.some((w) => w.startsWith(q)));
}

const MAX_PER_KIND = 8;

export function QuickWake({ onPick }: { onPick: (intent: WakeIntent) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault(); // browsers bind Ctrl+K to the address bar search
        setOpen(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  if (!open) return null;
  return (
    <QuickWakeBody
      onClose={close}
      onPick={(intent) => {
        setOpen(false);
        onPick(intent);
      }}
    />
  );
}

function QuickWakeBody({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (intent: WakeIntent) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(query.trim(), 200);
  const rooms = useRooms();
  const tags = useTags();
  const devices = useDevices({ q, page: 1, pageSize: MAX_PER_KIND });

  const options: Option[] = [
    ...(rooms.data ?? [])
      .filter((r) => matches(`${r.name} ${r.code}`, query))
      .slice(0, MAX_PER_KIND)
      .map((r) => ({
        key: `room-${r.id}`,
        kind: 'Sala' as const,
        label: r.name,
        detail: `${r.deviceCount} máquina(s)`,
        intent: {
          title: `Ligar sala ${r.name}`,
          target: { type: 'rooms' as const, roomIds: [r.id], includeNoRoom: false },
        },
      })),
    ...(tags.data ?? [])
      .filter((t) => matches(t.name, query))
      .slice(0, MAX_PER_KIND)
      .map((t) => ({
        key: `tag-${t.id}`,
        kind: 'Etiqueta' as const,
        label: t.name,
        detail: `${t.deviceCount} máquina(s)`,
        intent: {
          title: `Ligar dispositivos com a etiqueta ${t.name}`,
          target: { type: 'tags' as const, tagIds: [t.id] },
        },
      })),
    ...(q === '' ? [] : (devices.data?.items ?? [])).map((d) => ({
      key: `device-${d.id}`,
      kind: 'Máquina' as const,
      label: d.name,
      detail: d.ip ?? d.mac,
      intent: { title: `Ligar ${d.name}`, target: { type: 'devices' as const, deviceIds: [d.id] } },
    })),
  ];
  const current = Math.min(active, Math.max(0, options.length - 1));

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(current + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[current];
      if (o) onPick(o.intent);
    }
  }

  return (
    <Dialog open title="Ligar rapidamente" onClose={onClose}>
      <input
        type="text"
        role="combobox"
        aria-label="Sala, etiqueta ou máquina"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={options[current] ? `${listId}-${options[current].key}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Digite para buscar, Enter para ligar"
        maxLength={100}
        className="w-full rounded-md border border-slate-300 px-3 py-2"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Resultados"
        className="mt-3 max-h-80 overflow-y-auto"
      >
        {options.map((o, i) => (
          <li
            key={o.key}
            id={`${listId}-${o.key}`}
            role="option"
            aria-selected={i === current}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(o.intent)}
            className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm ${
              i === current ? 'bg-blue-100 text-blue-950' : ''
            }`}
          >
            <span className="w-20 shrink-0 text-xs font-semibold uppercase text-slate-600">
              {o.kind}
            </span>
            <span className="flex-1 font-medium">{o.label}</span>
            <span className="text-slate-600">{o.detail}</span>
          </li>
        ))}
      </ul>
      {options.length === 0 && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          Nada encontrado.
        </p>
      )}
      <p className="mt-3 text-xs text-slate-600">
        ↑ ↓ para escolher · Enter para ligar · Esc para fechar. A confirmação de ações grandes
        continua valendo.
      </p>
    </Dialog>
  );
}
