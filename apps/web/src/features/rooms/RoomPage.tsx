import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { Device } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { useDevices, useRoom, useRooms, useTags } from '../../api/hooks';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { Button, PageHeader } from '../../components/ui';
import { BulkBar } from '../devices/BulkBar';
import { DeviceFormDialog } from '../devices/DeviceFormDialog';
import { DevicesTable } from '../devices/DevicesTable';
import { noticeFromSave, SaveNotice, useSelection } from '../devices/DevicesPage';
import { useWakeUi } from '../wake/WakeProvider';
import { RoomFormDialog } from './RoomFormDialog';

/** Bookmarkable room page `/salas/:id` (FR-008.3). Wake buttons arrive in M3. */
export function RoomPage() {
  const id = Number(useParams().id);
  const room = useRoom(id);
  const rooms = useRooms();
  const tags = useTags();
  const devices = useDevices({ roomId: id, page: 1, pageSize: 200 });
  const selection = useSelection();
  const { requestWake } = useWakeUi();
  const [editing, setEditing] = useState<Device | undefined>(undefined);
  const [deviceFormOpen, setDeviceFormOpen] = useState(false);
  const [roomFormOpen, setRoomFormOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null);

  if (room.isPending) return <LoadingState />;
  if (room.isError) {
    if (room.error instanceof ApiRequestError && room.error.status === 404) {
      return (
        <EmptyState title="Sala não encontrada">
          <Link to="/salas" className="text-blue-800 underline">
            Ver todas as salas
          </Link>
        </EmptyState>
      );
    }
    return <ErrorState message={room.error.message} onRetry={() => void room.refetch()} />;
  }
  const r = room.data;
  const online = devices.data?.items.filter((d) => d.status === 'online').length ?? 0;

  return (
    <section>
      <nav aria-label="Trilha" className="mb-2 text-sm">
        <Link to="/salas" className="text-blue-800 underline">
          Salas
        </Link>{' '}
        / {r.name}
      </nav>
      <PageHeader
        title={r.name}
        actions={
          <>
            <Button
              variant="primary"
              onClick={() =>
                requestWake({
                  title: `Ligar sala ${r.name}`,
                  target: { type: 'rooms', roomIds: [id], includeNoRoom: false },
                })
              }
            >
              Ligar sala
            </Button>
            <Button
              onClick={() =>
                requestWake({
                  title: `Ligar só os desligados — ${r.name}`,
                  target: { type: 'rooms', roomIds: [id], includeNoRoom: false },
                  onlyOffline: true,
                })
              }
            >
              Ligar só os desligados
            </Button>
            <Button onClick={() => setRoomFormOpen(true)}>Editar sala</Button>
            <Button
              onClick={() => {
                setEditing(undefined);
                setDeviceFormOpen(true);
              }}
            >
              Adicionar máquina
            </Button>
          </>
        }
      />
      <p className="mb-4 text-slate-700">
        Código <strong>{r.code}</strong>
        {r.block ? ` · Bloco ${r.block}` : ''}
        {r.floor ? ` · Andar ${r.floor}` : ''} ·{' '}
        <span aria-label={`${online} de ${r.deviceCount} ligadas`}>
          {online}/{r.deviceCount} ligadas
        </span>
      </p>

      <SaveNotice notice={notice} onDismiss={() => setNotice(null)} />

      {devices.isPending ? (
        <LoadingState />
      ) : devices.isError ? (
        <ErrorState message={devices.error.message} onRetry={() => void devices.refetch()} />
      ) : devices.data.items.length === 0 ? (
        <EmptyState title="Nenhuma máquina nesta sala">
          Adicione uma máquina, mova dispositivos para cá ou use "Preparar máquinas".
        </EmptyState>
      ) : (
        <>
          {devices.data.total > devices.data.items.length && (
            <p role="status" className="mb-2 text-sm text-slate-700">
              Mostrando {devices.data.items.length} de {devices.data.total} máquinas.{' '}
              <Link to={`/dispositivos?sala=${id}`} className="text-blue-800 underline">
                Ver todas em Dispositivos
              </Link>
            </p>
          )}
          <DevicesTable
            devices={devices.data.items}
            rooms={rooms.data ?? []}
            tags={tags.data ?? []}
            selected={selection.selected}
            onToggle={selection.toggle}
            onToggleAll={selection.toggleAll}
            onEdit={(d) => {
              setEditing(d);
              setDeviceFormOpen(true);
            }}
            showRoom={false}
          />
        </>
      )}

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
        open={deviceFormOpen}
        device={editing}
        defaultRoomId={id}
        onClose={() => setDeviceFormOpen(false)}
        onSaved={(result) => {
          setDeviceFormOpen(false);
          setNotice(noticeFromSave(result, editing === undefined));
        }}
      />
      <RoomFormDialog
        open={roomFormOpen}
        room={r}
        onClose={() => setRoomFormOpen(false)}
        onSaved={() => setRoomFormOpen(false)}
      />
    </section>
  );
}
