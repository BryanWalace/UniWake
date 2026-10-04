import { useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { type RoomWithCount, type TagWithCount, useBulkDevices } from '../../api/hooks';
import { Button, ConfirmDialog } from '../../components/ui';

/** Bulk actions for the selected devices (FR-002.2). Delete asks for confirmation with the count. */
export function BulkBar({
  selected,
  rooms,
  tags,
  onDone,
}: {
  selected: number[];
  rooms: RoomWithCount[];
  tags: TagWithCount[];
  onDone: (message: string) => void;
}) {
  const bulk = useBulkDevices();
  const [roomId, setRoomId] = useState('');
  const [tagId, setTagId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = selected.length;

  async function run(body: Parameters<typeof bulk.mutateAsync>[0], message: string) {
    setError(null);
    try {
      await bulk.mutateAsync(body);
      onDone(message);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    }
  }

  return (
    <div
      role="region"
      aria-label="Ações em lote"
      className="sticky bottom-0 z-10 mt-3 rounded-lg border border-blue-300 bg-blue-50 p-3 shadow"
    >
      <div className="flex flex-wrap items-end gap-3">
        <p className="font-semibold text-blue-950">{n} selecionado(s)</p>
        <div className="flex items-end gap-2">
          <label className="text-sm">
            <span className="block font-medium">Mover para</span>
            <select
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              <option value="">Escolha…</option>
              <option value="none">Sem sala</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={!roomId || bulk.isPending}
            onClick={() =>
              void run(
                {
                  action: 'move',
                  deviceIds: selected,
                  roomId: roomId === 'none' ? null : Number(roomId),
                },
                `${n} dispositivo(s) movido(s).`,
              )
            }
          >
            Mover
          </Button>
        </div>
        {tags.length > 0 && (
          <div className="flex items-end gap-2">
            <label className="text-sm">
              <span className="block font-medium">Etiqueta</span>
              <select
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5"
                value={tagId}
                onChange={(e) => setTagId(e.target.value)}
              >
                <option value="">Escolha…</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={!tagId || bulk.isPending}
              onClick={() =>
                void run(
                  { action: 'addTags', deviceIds: selected, tagIds: [Number(tagId)] },
                  'Etiqueta adicionada.',
                )
              }
            >
              Adicionar
            </Button>
            <Button
              disabled={!tagId || bulk.isPending}
              onClick={() =>
                void run(
                  { action: 'removeTags', deviceIds: selected, tagIds: [Number(tagId)] },
                  'Etiqueta removida.',
                )
              }
            >
              Remover
            </Button>
          </div>
        )}
        <Button
          disabled={bulk.isPending}
          onClick={() => void run({ action: 'enable', deviceIds: selected }, `${n} ativado(s).`)}
        >
          Ativar
        </Button>
        <Button
          disabled={bulk.isPending}
          onClick={() =>
            void run({ action: 'disable', deviceIds: selected }, `${n} desativado(s).`)
          }
        >
          Desativar
        </Button>
        <Button variant="danger" disabled={bulk.isPending} onClick={() => setConfirmDelete(true)}>
          Excluir
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Excluir dispositivos"
        confirmLabel={`Excluir ${n} dispositivo(s)`}
        danger
        busy={bulk.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void run(
            { action: 'delete', deviceIds: selected, confirm: true },
            `${n} dispositivo(s) excluído(s).`,
          );
        }}
      >
        <p>
          Excluir <strong>{n}</strong> dispositivo(s)? O histórico deles também será removido. Esta
          ação não pode ser desfeita.
        </p>
      </ConfirmDialog>
    </div>
  );
}
