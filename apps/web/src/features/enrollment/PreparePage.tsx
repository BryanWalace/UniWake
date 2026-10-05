import { type FormEvent, useState } from 'react';
import type {
  CreatedEnrollmentToken,
  EnrollmentToken,
  EnrollmentTokenState,
} from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { useRooms } from '../../api/hooks';
import { ErrorState, LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, ConfirmDialog, PageHeader, SelectField } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import {
  useCreateToken,
  useEnrollmentCommand,
  useEnrollmentAddresses,
  useEnrollmentTokens,
  useRevokeToken,
} from './api';

const STATE_TEXT: Record<EnrollmentTokenState, string> = {
  ativo: 'Ativo',
  expirado: 'Expirado',
  revogado: 'Revogado',
  esgotado: 'Limite de usos atingido',
};

const errorText = (e: unknown) => (e instanceof ApiRequestError ? e.message : 'Erro inesperado.');

/** Preparar máquinas (FR-007.3, ADR-011): code → hash-pinned one-line command per room. */
export function PreparePage() {
  const [created, setCreated] = useState<CreatedEnrollmentToken | null>(null);
  return (
    <section className="space-y-6">
      <PageHeader title="Preparar máquinas" />
      <p className="max-w-3xl text-sm text-slate-700">
        Prepare os computadores de uma sala para serem ligados pelo UniWake e cadastre-os
        automaticamente. Gere um código para a sala, copie o comando e execute-o em cada computador,
        em um PowerShell aberto como Administrador.
      </p>
      <GenerateSection onCreated={setCreated} />
      {created && <CommandSection token={created} />}
      <TokensSection />
      <BiosChecklist />
      <OfflineSection />
    </section>
  );
}

function GenerateSection({ onCreated }: { onCreated: (t: CreatedEnrollmentToken) => void }) {
  const rooms = useRooms();
  const create = useCreateToken();
  const [roomId, setRoomId] = useState('');
  const [hours, setHours] = useState('');
  const [uses, setUses] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (roomId === '') {
      setError('Escolha a sala.');
      return;
    }
    try {
      onCreated(
        await create.mutateAsync({
          roomId: Number(roomId),
          ...(hours !== '' ? { expiresHours: Number(hours) } : {}),
          ...(uses !== '' ? { maxUses: Number(uses) } : {}),
        }),
      );
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby="gerar-titulo"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="gerar-titulo" className="text-lg font-bold">
        1. Gerar código de cadastro
      </h2>
      {rooms.isPending ? (
        <LoadingState />
      ) : rooms.isError ? (
        <ErrorState message={rooms.error.message} onRetry={() => void rooms.refetch()} />
      ) : rooms.data.length === 0 ? (
        <p className="text-sm">Cadastre uma sala em “Salas” antes de preparar computadores.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Sala" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Escolha…</option>
            {rooms.data.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.code})
              </option>
            ))}
          </SelectField>
          <TextField
            label="Validade (horas)"
            hint="Vazio = padrão do UniWake (8 h)."
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <TextField
            label="Máximo de computadores"
            hint="Vazio = padrão do UniWake (100)."
            type="number"
            min={1}
            max={10000}
            value={uses}
            onChange={(e) => setUses(e.target.value)}
          />
        </div>
      )}
      <FormError message={error} />
      <Button type="submit" variant="primary" disabled={create.isPending || !rooms.data?.length}>
        Gerar código
      </Button>
    </form>
  );
}

function CommandSection({ token }: { token: CreatedEnrollmentToken }) {
  const addresses = useEnrollmentAddresses();
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const chosen = address ?? addresses.data?.selected ?? null;
  const built = useEnrollmentCommand(token.token, chosen);
  const command = built.data ?? null;
  const error = copyError ?? (built.isError ? errorText(built.error) : null);

  function choose(next: string) {
    setAddress(next);
    setCopied(false);
    setCopyError(null);
  }

  async function copy() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command.command);
      setCopied(true);
    } catch {
      setCopyError('Não foi possível copiar. Selecione o comando e copie com Ctrl+C.');
    }
  }

  return (
    <section
      aria-labelledby="comando-titulo"
      className="space-y-3 rounded-lg border border-blue-300 bg-blue-50 p-4"
    >
      <h2 id="comando-titulo" className="text-lg font-bold">
        2. Comando para a sala {token.roomName}
      </h2>
      <p className="text-sm">
        Este código aparece só agora. Ele vale até{' '}
        <strong>{formatDateTime(token.expiresAt)}</strong> e para até{' '}
        <strong>{token.maxUses}</strong> computadores.
      </p>
      {addresses.isPending ? (
        <LoadingState />
      ) : addresses.isError ? (
        <ErrorState message={addresses.error.message} onRetry={() => void addresses.refetch()} />
      ) : addresses.data.addresses.length === 0 ? (
        <p role="alert" className="text-sm text-red-800">
          Este computador não tem uma placa de rede com endereço válido. Verifique o cabo de rede e
          tente de novo.
        </p>
      ) : (
        <SelectField
          label="Endereço do UniWake que os computadores vão usar"
          value={chosen ?? ''}
          onChange={(e) => choose(e.target.value)}
          className="max-w-md"
        >
          {addresses.data.addresses.map((a) => (
            <option key={a.address} value={a.address}>
              {a.address} — {a.interfaceName}
              {a.hasGateway ? ' (rede principal)' : ''}
            </option>
          ))}
        </SelectField>
      )}
      <FormError message={error} />
      {command && (
        <>
          <label htmlFor="comando" className="block text-sm font-medium">
            Comando (PowerShell como Administrador)
          </label>
          <textarea
            id="comando"
            readOnly
            rows={4}
            value={command.command}
            onFocus={(e) => e.currentTarget.select()}
            className="block w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => void copy()}>
              Copiar comando
            </Button>
            {copied && (
              <span role="status" className="text-sm text-green-800">
                Comando copiado.
              </span>
            )}
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              Em cada computador da sala, clique com o botão direito em Iniciar e abra “Terminal
              (Administrador)” ou “Windows PowerShell (Administrador)”.
            </li>
            <li>Cole o comando e pressione Enter.</li>
            <li>
              O comando confere se o arquivo baixado é o mesmo deste UniWake (SHA-256{' '}
              <code className="break-all">{command.sha256.slice(0, 12)}…</code>) antes de
              executá-lo. Se aparecer “Arquivo alterado — não execute”, avise a equipe de TI.
            </li>
            <li>No fim, o resumo mostra o que foi ajustado e o que conferir na BIOS.</li>
          </ol>
        </>
      )}
    </section>
  );
}

function TokensSection() {
  const tokens = useEnrollmentTokens();
  const revoke = useRevokeToken();
  const [revoking, setRevoking] = useState<EnrollmentToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirmRevoke() {
    if (!revoking) return;
    setError(null);
    try {
      await revoke.mutateAsync(revoking.id);
    } catch (e) {
      setError(errorText(e));
    }
    setRevoking(null);
  }

  return (
    <section aria-labelledby="codigos-titulo" className="space-y-2">
      <h2 id="codigos-titulo" className="text-lg font-bold">
        Códigos de cadastro
      </h2>
      <FormError message={error} />
      {tokens.isPending ? (
        <LoadingState />
      ) : tokens.isError ? (
        <ErrorState message={tokens.error.message} onRetry={() => void tokens.refetch()} />
      ) : tokens.data.length === 0 ? (
        <p className="text-sm text-slate-700">Nenhum código gerado nos últimos 30 dias.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Códigos de cadastro</caption>
            <thead className="bg-slate-50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Sala
                </th>
                <th scope="col" className="px-3 py-2">
                  Gerado por
                </th>
                <th scope="col" className="px-3 py-2">
                  Válido até
                </th>
                <th scope="col" className="px-3 py-2">
                  Computadores
                </th>
                <th scope="col" className="px-3 py-2">
                  Situação
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.data.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{t.roomName}</td>
                  <td className="px-3 py-2">{t.createdBy ?? '—'}</td>
                  <td className="px-3 py-2">{formatDateTime(t.expiresAt)}</td>
                  <td className="px-3 py-2">
                    {t.uses} de {t.maxUses}
                  </td>
                  <td className="px-3 py-2">{STATE_TEXT[t.state]}</td>
                  <td className="px-3 py-2">
                    {t.state === 'ativo' && (
                      <Button
                        variant="ghost"
                        aria-label={`Revogar código da sala ${t.roomName} gerado em ${formatDateTime(t.createdAt)}`}
                        onClick={() => setRevoking(t)}
                      >
                        Revogar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={revoking !== null}
        title="Revogar código de cadastro"
        confirmLabel="Revogar"
        danger
        busy={revoke.isPending}
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setRevoking(null)}
      >
        Computadores que ainda não executaram o comando da sala {revoking?.roomName} não poderão
        mais se cadastrar com ele. Os já cadastrados continuam no UniWake.
      </ConfirmDialog>
    </section>
  );
}

function BiosChecklist() {
  return (
    <section
      aria-labelledby="bios-titulo"
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm"
    >
      <h2 id="bios-titulo" className="text-lg font-bold">
        Conferir na BIOS/UEFI
      </h2>
      <p>O script não consegue alterar a BIOS. Em cada modelo, confira uma vez:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Wake on LAN / Power On by PCI-E / Remote Wake Up: ativado.</li>
        <li>ErP / EuP / Deep Sleep / economia de energia no desligamento: desativado.</li>
        <li>
          <strong>Dell:</strong> Power Management → Wake on LAN = LAN Only; Deep Sleep Control =
          Disabled.
        </li>
        <li>
          <strong>HP:</strong> Advanced → Power-On Options → Remote Wake Up Boot Source = Remote
          Server; S5 Wake on LAN = Enabled.
        </li>
        <li>
          <strong>Lenovo:</strong> Power → Wake on LAN = Automatic ou Primary; Enhanced Power Saving
          Mode = Disabled.
        </li>
      </ul>
    </section>
  );
}

function OfflineSection() {
  const addresses = useEnrollmentAddresses();
  const a = addresses.data;
  if (!a?.selected) return null;
  const url = `http://${a.selected}:${a.agentPort}/agent/prepare-target.ps1`;
  return (
    <section aria-labelledby="offline-titulo" className="space-y-2 text-sm">
      <h2 id="offline-titulo" className="text-lg font-bold">
        Usar sem o comando
      </h2>
      <p>
        <a href={url} className="font-semibold text-blue-800 underline">
          Baixar prepare-target.ps1
        </a>{' '}
        para levar em um pendrive. Execute como Administrador com{' '}
        <code>-HubUrl -RoomCode -Token</code> para cadastrar, ou com <code>-SkipEnrollment</code> só
        para preparar. <code>-WhatIf</code> mostra o que seria alterado sem alterar nada.
      </p>
    </section>
  );
}
