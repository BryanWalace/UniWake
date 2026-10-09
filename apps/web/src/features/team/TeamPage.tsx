import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { TeamMember, TeamStatus } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, ConfirmDialog, Dialog, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import {
  useCancelPairing,
  useDiscovered,
  useJoinTeam,
  useLeaveTeam,
  useOpenPairing,
  useRevokeMember,
  useSyncNow,
  useTeam,
  useUpdateMember,
} from './api';

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado.');

/** FR-201/FR-202.6: pairing, joining and the team's PCs. */
export function TeamPage() {
  const team = useTeam();
  if (team.isPending) return <LoadingState />;
  if (team.isError)
    return <ErrorState message={team.error.message} onRetry={() => void team.refetch()} />;
  const t = team.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Modo equipe"
        actions={
          t.inTeam ? (
            <>
              <SyncNowButton />
              <Link
                to="/equipe/conflitos"
                className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold text-blue-800 hover:bg-blue-50"
              >
                Conflitos resolvidos
              </Link>
            </>
          ) : undefined
        }
      />
      <p className="max-w-3xl text-slate-700">
        Com o Modo equipe, os PCs da equipe de TI mantêm o mesmo cadastro (salas, máquinas,
        etiquetas, agendamentos, usuários) pela rede local, sem servidor. Cada agendamento é
        executado por um único PC ligado. Veja{' '}
        <Link to="/ajuda/team-mode" className="text-blue-800 underline">
          como funciona
        </Link>
        .
      </p>
      {t.inTeam ? <Members status={t} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <PairCard status={t} />
        {!t.inTeam && <JoinCard />}
      </div>
      {t.inTeam && <LeaveCard />}
    </div>
  );
}

function SyncNowButton() {
  const sync = useSyncNow();
  return (
    <Button variant="primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
      {sync.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
    </Button>
  );
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.round((until - now) / 1000));
  return (
    <span>
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </span>
  );
}

/** FR-201.1: the code is shown here and typed on the other PC. */
function PairCard({ status }: { status: TeamStatus }) {
  const open = useOpenPairing();
  const cancel = useCancelPairing();
  const p = status.pairing;
  return (
    <section
      aria-labelledby="pair-title"
      className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200"
    >
      <h2 id="pair-title" className="text-lg font-bold">
        Parear com outro PC
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        Use neste PC se ele já tem o cadastro (ou já está na equipe). O outro PC recebe os dados
        deste.
      </p>
      {p.open && p.code ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm">No outro PC, abra Modo equipe › Entrar em uma equipe e digite:</p>
          <p
            aria-label="Código de pareamento"
            className="font-mono text-4xl font-bold tracking-[0.3em] text-blue-900"
          >
            {p.code}
          </p>
          <p className="text-sm text-slate-700">
            Válido por <Countdown until={p.expiresAt!} /> · {p.attemptsLeft} tentativas · endereço
            deste PC: <strong>{status.addresses.join(', ') || '—'}</strong> (porta {status.port})
          </p>
          <Button onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            Cancelar código
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="primary" onClick={() => open.mutate()} disabled={open.isPending}>
            Gerar código de pareamento
          </Button>
          <FormError message={open.isError ? errorText(open.error) : null} />
        </div>
      )}
    </section>
  );
}

/** FR-201.2: joins the team of another PC; this PC's data is replaced by the team's. */
function JoinCard() {
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState<Record<string, number> | null>(null);
  const discovered = useDiscovered(true);
  const join = useJoinTeam();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    join.mutate(
      { address: address.trim(), code: code.trim(), ...(needsConfirm ? { confirm } : {}) },
      {
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === 'TEAM_REPLACE_CONFIRM') {
            setNeedsConfirm((err.details as Record<string, number> | undefined) ?? {});
          }
        },
      },
    );
  };
  return (
    <section
      aria-labelledby="join-title"
      className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200"
    >
      <h2 id="join-title" className="text-lg font-bold">
        Entrar em uma equipe
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        Use neste PC para receber o cadastro de outro PC. Depois de entrar, use os usuários e senhas
        da equipe para acessar o painel.
      </p>
      <div className="mt-3">
        <h3 className="text-sm font-semibold">PCs com código aberto na rede</h3>
        {discovered.isPending ? (
          <LoadingState label="Procurando…" />
        ) : discovered.isError ? (
          <ErrorState message={discovered.error.message} />
        ) : discovered.data.length === 0 ? (
          <p className="text-sm text-slate-600">
            Nenhum encontrado ainda. Gere o código no outro PC ou digite o endereço dele (necessário
            se ele estiver em outra sub-rede).
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {discovered.data.map((d) => (
              <li key={d.instanceId}>
                <Button onClick={() => setAddress(d.address)} aria-pressed={address === d.address}>
                  {d.name} ({d.address})
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <TextField
          label="Endereço do outro PC"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="ex.: 10.0.3.20 ou TI-MANHA"
          required
        />
        <TextField
          label="Código de 6 dígitos"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          maxLength={6}
          pattern="\d{6}"
          required
        />
        {needsConfirm && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p>
              Este PC tem {needsConfirm.rooms ?? 0} salas, {needsConfirm.devices ?? 0} máquinas,{' '}
              {needsConfirm.tags ?? 0} etiquetas e {needsConfirm.schedules ?? 0} agendamentos que
              serão substituídos pelos da equipe. Um backup é feito antes.
            </p>
            <TextField
              label="Digite SUBSTITUIR para confirmar"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-2"
            />
          </div>
        )}
        <FormError
          message={
            join.isError &&
            !(
              join.error instanceof ApiRequestError &&
              join.error.code === 'TEAM_REPLACE_CONFIRM' &&
              !confirm
            )
              ? errorText(join.error)
              : null
          }
        />
        <Button type="submit" variant="primary" disabled={join.isPending}>
          {join.isPending ? 'Pareando…' : 'Entrar na equipe'}
        </Button>
      </form>
    </section>
  );
}

function Members({ status }: { status: TeamStatus }) {
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [revoking, setRevoking] = useState<TeamMember | null>(null);
  const revoke = useRevokeMember();
  if (status.members.length === 0) return <EmptyState title="Nenhum PC na equipe ainda." />;
  return (
    <section aria-labelledby="members-title">
      <h2 id="members-title" className="mb-2 text-lg font-bold">
        PCs da equipe
      </h2>
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">PC</th>
              <th className="px-3 py-2">Situação</th>
              <th className="px-3 py-2">Endereço</th>
              <th className="px-3 py-2">Última sincronização</th>
              <th className="px-3 py-2">Pendentes</th>
              <th className="px-3 py-2">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {status.members.map((m) => (
              <tr key={m.instanceId} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 font-semibold">
                  {m.name}
                  {m.self && <span className="ml-1 font-normal text-slate-600">(este PC)</span>}
                </td>
                <td className="px-3 py-2">
                  {m.revoked ? (
                    <span className="text-red-800">Removido</span>
                  ) : m.online ? (
                    <span className="text-green-800">Online</span>
                  ) : (
                    <span className="text-slate-700">Offline</span>
                  )}
                  {m.lastError && !m.self && !m.revoked && (
                    <p className="mt-1 max-w-xs text-xs text-amber-900">{m.lastError}</p>
                  )}
                </td>
                <td className="px-3 py-2">
                  {m.self ? '—' : (m.manualAddress ?? m.address ?? 'não encontrado')}
                  {m.manualAddress && <span className="ml-1 text-xs text-slate-600">(fixo)</span>}
                </td>
                <td className="px-3 py-2">
                  {m.self ? '—' : m.lastSyncAt ? formatDateTime(m.lastSyncAt) : 'nunca'}
                </td>
                <td className="px-3 py-2">{m.self ? '—' : m.pending}</td>
                <td className="px-3 py-2 text-right">
                  {!m.revoked && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => setEditing(m)}>
                        Editar
                      </Button>
                      {!m.self && (
                        <Button variant="ghost" onClick={() => setRevoking(m)}>
                          Remover da equipe
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <MemberDialog member={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={revoking !== null}
        title="Remover PC da equipe"
        confirmLabel="Remover"
        danger
        busy={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() =>
          revoking && revoke.mutate(revoking.instanceId, { onSuccess: () => setRevoking(null) })
        }
      >
        <p>
          {revoking?.name} deixará de sincronizar. A chave da equipe é trocada; os PCs desligados
          recebem a nova chave quando ligarem. Os dados que já estão nele continuam nele.
        </p>
      </ConfirmDialog>
    </section>
  );
}

function MemberDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const [name, setName] = useState(member.name);
  const [address, setAddress] = useState(member.manualAddress ?? '');
  const update = useUpdateMember();
  const save = () =>
    update.mutate(
      {
        instanceId: member.instanceId,
        ...(name.trim() !== member.name ? { name: name.trim() } : {}),
        ...(member.self ? {} : { address: address.trim() === '' ? null : address.trim() }),
      },
      { onSuccess: onClose },
    );
  return (
    <Dialog
      open
      title={`Editar ${member.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={update.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField
          label="Nome do PC na equipe"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
        />
        {!member.self && (
          <TextField
            label="Endereço fixo (opcional)"
            hint="Para um PC em outra sub-rede, onde os anúncios não chegam. Vazio = encontrar automaticamente."
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        )}
        <FormError message={update.isError ? errorText(update.error) : null} />
      </div>
    </Dialog>
  );
}

function LeaveCard() {
  const [open, setOpen] = useState(false);
  const leave = useLeaveTeam();
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">Sair da equipe</h2>
      <p className="mt-1 text-sm text-slate-700">
        Este PC para de sincronizar. O cadastro que já está nele continua aqui.
      </p>
      <Button className="mt-2" onClick={() => setOpen(true)}>
        Sair da equipe
      </Button>
      <ConfirmDialog
        open={open}
        title="Sair da equipe"
        confirmLabel="Sair"
        danger
        busy={leave.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => leave.mutate(undefined, { onSuccess: () => setOpen(false) })}
      >
        <p>Para voltar, será preciso parear de novo com um PC da equipe.</p>
      </ConfirmDialog>
    </section>
  );
}
