import { useState } from 'react';
import { Link } from 'react-router';
import type { RoomDeleteImpact } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import {
  roomDeleteImpact,
  type RoomWithCount,
  tagDeleteImpact,
  type TagWithCount,
  useDeleteRoom,
  useDeleteTag,
  useRooms,
  useSaveTag,
  useTags,
} from '../../api/hooks';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, ConfirmDialog, Dialog, PageHeader, TagChip } from '../../components/ui';
import { RoomFormDialog } from './RoomFormDialog';

interface PendingDelete {
  kind: 'room' | 'tag';
  id: number;
  name: string;
  impact: RoomDeleteImpact;
}

/** Rooms and tags management (FR-008.1, FR-008.2). */
export function RoomsPage() {
  const rooms = useRooms();
  const tags = useTags();
  const deleteRoom = useDeleteRoom();
  const deleteTag = useDeleteTag();
  const [editRoom, setEditRoom] = useState<RoomWithCount | undefined>(undefined);
  const [roomFormOpen, setRoomFormOpen] = useState(false);
  const [editTag, setEditTag] = useState<TagWithCount | 'new' | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function askDelete(kind: 'room' | 'tag', id: number, name: string) {
    setError(null);
    try {
      const impact = kind === 'room' ? await roomDeleteImpact(id) : await tagDeleteImpact(id);
      setPending({ kind, id, name, impact });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    }
  }

  async function confirmDelete() {
    if (!pending) return;
    try {
      const mutation = pending.kind === 'room' ? deleteRoom : deleteTag;
      await mutation.mutateAsync({ id: pending.id, confirm: true });
      setMessage(`${pending.kind === 'room' ? 'Sala' : 'Etiqueta'} "${pending.name}" excluída.`);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="space-y-8">
      <div>
        <PageHeader
          title="Salas"
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setEditRoom(undefined);
                setRoomFormOpen(true);
              }}
            >
              Nova sala
            </Button>
          }
        />
        {message && (
          <p
            role="status"
            className="mb-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm"
          >
            {message}
          </p>
        )}
        <FormError message={error} />
        {rooms.isPending ? (
          <LoadingState />
        ) : rooms.isError ? (
          <ErrorState message={rooms.error.message} onRetry={() => void rooms.refetch()} />
        ) : rooms.data.length === 0 ? (
          <EmptyState title="Nenhuma sala cadastrada">
            Crie a primeira sala para organizar as máquinas.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {rooms.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span
                  aria-hidden="true"
                  className="h-8 w-1.5 rounded"
                  style={{ backgroundColor: r.color }}
                />
                <div className="min-w-48 flex-1">
                  <Link
                    to={`/salas/${r.id}`}
                    className="font-semibold text-blue-800 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <p className="text-sm text-slate-600">
                    Código {r.code}
                    {r.block ? ` · Bloco ${r.block}` : ''}
                    {r.floor ? ` · Andar ${r.floor}` : ''} · {r.deviceCount} máquina(s)
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setEditRoom(r);
                    setRoomFormOpen(true);
                  }}
                  aria-label={`Editar sala ${r.name}`}
                >
                  Editar
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void askDelete('room', r.id, r.name)}
                  aria-label={`Excluir sala ${r.name}`}
                >
                  Excluir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <PageHeader
          title="Etiquetas"
          actions={<Button onClick={() => setEditTag('new')}>Nova etiqueta</Button>}
        />
        {tags.isPending ? (
          <LoadingState />
        ) : tags.isError ? (
          <ErrorState message={tags.error.message} onRetry={() => void tags.refetch()} />
        ) : tags.data.length === 0 ? (
          <EmptyState title="Nenhuma etiqueta">
            Use etiquetas como "professor", "projetor" ou "Win11" para ligar grupos de máquinas.
          </EmptyState>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tags.data.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <TagChip name={t.name} color={t.color} />
                <span className="text-sm text-slate-600">{t.deviceCount} máquina(s)</span>
                <Button
                  variant="ghost"
                  onClick={() => setEditTag(t)}
                  aria-label={`Editar etiqueta ${t.name}`}
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void askDelete('tag', t.id, t.name)}
                  aria-label={`Excluir etiqueta ${t.name}`}
                >
                  Excluir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <RoomFormDialog
        open={roomFormOpen}
        room={editRoom}
        onClose={() => setRoomFormOpen(false)}
        onSaved={(r) => {
          setRoomFormOpen(false);
          setMessage(`Sala "${r.name}" salva (código ${r.code}).`);
        }}
      />
      <TagFormDialog
        tag={editTag}
        onClose={() => setEditTag(null)}
        onSaved={(t) => {
          setEditTag(null);
          setMessage(`Etiqueta "${t.name}" salva.`);
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'room' ? 'Excluir sala' : 'Excluir etiqueta'}
        confirmLabel="Excluir"
        danger
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmDelete()}
      >
        {pending && (
          <>
            <p>
              Excluir <strong>{pending.name}</strong>?
            </p>
            {pending.kind === 'room' && pending.impact.deviceCount > 0 && (
              <p>{pending.impact.deviceCount} máquina(s) irão para "Sem sala".</p>
            )}
            {pending.kind === 'tag' && pending.impact.deviceCount > 0 && (
              <p>A etiqueta será removida de {pending.impact.deviceCount} máquina(s).</p>
            )}
            {pending.impact.schedules.length > 0 && (
              <div>
                <p>Agendamentos que usam este item e podem ficar sem alvo:</p>
                <ul className="list-disc pl-5">
                  {pending.impact.schedules.map((s) => (
                    <li key={s.id}>{s.name}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </ConfirmDialog>
    </section>
  );
}

function TagFormDialog({
  tag,
  onClose,
  onSaved,
}: {
  tag: TagWithCount | 'new' | null;
  onClose: () => void;
  onSaved: (t: TagWithCount) => void;
}) {
  if (tag === null) return null;
  return (
    <TagFormBody
      key={tag === 'new' ? 'new' : tag.id}
      tag={tag}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function TagFormBody({
  tag,
  onClose,
  onSaved,
}: {
  tag: TagWithCount | 'new';
  onClose: () => void;
  onSaved: (t: TagWithCount) => void;
}) {
  const save = useSaveTag();
  const existing = tag === 'new' ? undefined : tag;
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? '#64748b');
  const [error, setError] = useState<string | undefined>(undefined);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      onSaved(await save.mutateAsync({ id: existing?.id, data: { name, color } }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
    }
  }
  return (
    <Dialog
      open
      title={existing ? `Editar ${existing.name}` : 'Nova etiqueta'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="tag-form" disabled={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="tag-form" onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
        <TextField
          label="Nome da etiqueta"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          maxLength={32}
          required
        />
        <TextField
          label="Cor"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </form>
    </Dialog>
  );
}
