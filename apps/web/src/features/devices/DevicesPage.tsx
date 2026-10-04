import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Device, DeviceSaveResult, DeviceStatus } from '@uniwake/shared';
import { type DeviceQueryParams, useDevices, useRooms, useTags } from '../../api/hooks';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { Button, PageHeader, SelectField } from '../../components/ui';
import { BulkBar } from './BulkBar';
import { DeviceFormDialog, WARNING_TEXT } from './DeviceFormDialog';
import { DevicesTable } from './DevicesTable';

const PAGE_SIZE = 50;

/** Value that follows `value` after `ms` without changes (R-M2-03: no request per keystroke). */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function useSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  return {
    selected,
    toggle: (id: number) =>
      setSelected((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAll: (ids: number[], select: boolean) =>
      setSelected((cur) => {
        const next = new Set(cur);
        for (const id of ids) {
          if (select) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    clear: () => setSelected(new Set()),
  };
}

/** Notice shown after a save or bulk action, including non-blocking warnings (AC-002-06). */
export function SaveNotice({
  notice,
  onDismiss,
}: {
  notice: { text: string; warnings: string[] } | null;
  onDismiss: () => void;
}) {
  if (!notice) return null;
  return (
    <div
      role="status"
      className="mb-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-950"
    >
      <p className="font-medium">{notice.text}</p>
      {notice.warnings.map((w) => (
        <p key={w} className="mt-1 text-amber-900">
          ⚠ {w}
        </p>
      ))}
      <button type="button" onClick={onDismiss} className="mt-2 text-xs underline">
        Fechar aviso
      </button>
    </div>
  );
}

export function noticeFromSave(result: DeviceSaveResult, created: boolean) {
  return {
    text: `${result.device.name} ${created ? 'cadastrado' : 'salvo'}.`,
    warnings: result.warnings.map((w) => WARNING_TEXT[w]),
  };
}

/** Devices list (FR-002): filters, search, bulk actions, create/edit, CSV. */
export function DevicesPage() {
  const rooms = useRooms();
  const tags = useTags();
  const [params] = useSearchParams();
  const sala = params.get('sala');
  const [filters, setFilters] = useState<DeviceQueryParams>({
    page: 1,
    pageSize: PAGE_SIZE,
    ...(sala ? { roomId: sala === 'none' ? 'none' : Number(sala) } : {}),
  });
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const devices = useDevices({ ...filters, q });
  const selection = useSelection();
  const [editing, setEditing] = useState<Device | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null);

  const setFilter = (patch: Partial<DeviceQueryParams>) => {
    setFilters((f) => ({ ...f, ...patch, page: 1 }));
    selection.clear();
  };

  const page = devices.data;
  const from = page && page.total > 0 ? (page.page - 1) * page.pageSize + 1 : 0;
  const to = page ? Math.min(page.page * page.pageSize, page.total) : 0;

  return (
    <section>
      <PageHeader
        title="Dispositivos"
        actions={
          <>
            <a
              href="/api/devices/export.csv"
              download
              className="inline-flex min-h-10 items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-100"
            >
              Exportar CSV
            </a>
            <Link
              to="/dispositivos/importar"
              className="inline-flex min-h-10 items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-100"
            >
              Importar CSV
            </Link>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              Novo dispositivo
            </Button>
          </>
        }
      />

      <SaveNotice notice={notice} onDismiss={() => setNotice(null)} />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="busca-dispositivos" className="block text-sm font-medium text-slate-800">
            Buscar
          </label>
          <input
            id="busca-dispositivos"
            type="search"
            placeholder="Nome, IP, MAC ou host"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setFilters((f) => ({ ...f, page: 1 }));
              selection.clear();
            }}
          />
        </div>
        <SelectField
          label="Sala"
          value={filters.roomId === undefined ? '' : String(filters.roomId)}
          onChange={(e) => {
            const v = e.target.value;
            setFilter({ roomId: v === '' ? undefined : v === 'none' ? 'none' : Number(v) });
          }}
        >
          <option value="">Todas</option>
          <option value="none">Sem sala</option>
          {rooms.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Etiqueta"
          value={filters.tagId === undefined ? '' : String(filters.tagId)}
          onChange={(e) =>
            setFilter({ tagId: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        >
          <option value="">Todas</option>
          {tags.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Status"
          value={filters.status ?? ''}
          onChange={(e) =>
            setFilter({ status: (e.target.value || undefined) as DeviceStatus | undefined })
          }
        >
          <option value="">Todos</option>
          <option value="online">Ligado</option>
          <option value="offline">Desligado</option>
          <option value="desconhecido">Desconhecido</option>
        </SelectField>
      </div>

      {devices.isPending ? (
        <LoadingState />
      ) : devices.isError ? (
        <ErrorState message={devices.error.message} onRetry={() => void devices.refetch()} />
      ) : page && page.total === 0 ? (
        <EmptyState title="Nenhum dispositivo encontrado">
          Cadastre um dispositivo, importe um CSV ou use "Preparar máquinas" para que os
          computadores se cadastrem sozinhos.
        </EmptyState>
      ) : page ? (
        <>
          <DevicesTable
            devices={page.items}
            rooms={rooms.data ?? []}
            tags={tags.data ?? []}
            selected={selection.selected}
            onToggle={selection.toggle}
            onToggleAll={selection.toggleAll}
            onEdit={(d) => {
              setEditing(d);
              setFormOpen(true);
            }}
          />
          <nav aria-label="Paginação" className="mt-3 flex items-center justify-between text-sm">
            <p>
              Mostrando {from}–{to} de {page.total}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={page.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              >
                Anterior
              </Button>
              <Button
                disabled={to >= page.total}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              >
                Próxima
              </Button>
            </div>
          </nav>
        </>
      ) : null}

      {selection.selected.size > 0 && (
        <BulkBar
          selected={[...selection.selected]}
          rooms={rooms.data ?? []}
          tags={tags.data ?? []}
          onDone={(text) => {
            setNotice({ text, warnings: [] });
            selection.clear();
          }}
        />
      )}

      <DeviceFormDialog
        open={formOpen}
        device={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(result) => {
          setFormOpen(false);
          setNotice(noticeFromSave(result, editing === undefined));
        }}
      />
    </section>
  );
}
