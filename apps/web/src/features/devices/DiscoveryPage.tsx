import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import type { DiscoveredDevice, DiscoveryAddResult, DiscoveryState } from '@uniwake/shared';
import { api, ApiRequestError } from '../../api/client';
import { useRooms } from '../../api/hooks';
import { ErrorState, LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, ConfirmDialog, PageHeader, SelectField } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

const KEY = ['discovery'] as const;

/** A default device name: the host name, else "PC-<last octet>". */
const defaultName = (d: DiscoveredDevice) => d.hostname ?? `PC-${d.ip.split('.').at(-1)}`;

/** Descobrir na rede (FR-101): sweep one of this computer's subnets and add what answered. */
export function DiscoveryPage() {
  const qc = useQueryClient();
  const rooms = useRooms();
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<DiscoveryState>('/api/discovery'),
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 2_000 : false),
  });
  const [cidr, setCidr] = useState('');
  const [confirmLarge, setConfirmLarge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [roomId, setRoomId] = useState('');

  const scan = useMutation({
    mutationFn: (body: { cidr: string; confirmLarge?: boolean }) =>
      api.post<DiscoveryState>('/api/discovery/scan', body),
    onSuccess: (s) => qc.setQueryData(KEY, s),
  });
  const add = useMutation({
    mutationFn: (body: object) => api.post<DiscoveryAddResult>('/api/discovery/add', body),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });

  const s = status.data;
  const chosenCidr = cidr || s?.subnets[0]?.cidr || '';

  async function start(target: string, confirmed: boolean) {
    setError(null);
    setMessage(null);
    setConfirmLarge(null);
    try {
      await scan.mutateAsync({ cidr: target, ...(confirmed ? { confirmLarge: true } : {}) });
      setSelected({});
    } catch (e) {
      if (
        e instanceof ApiRequestError &&
        Array.isArray(e.details) &&
        (e.details as { path: string }[]).some((d) => d.path === 'confirmLarge')
      ) {
        // AC-101-01: a large network asks before sweeping.
        setConfirmLarge(target);
        return;
      }
      const detail =
        e instanceof ApiRequestError && Array.isArray(e.details)
          ? (e.details as { message: string }[])[0]?.message
          : null;
      setError(detail ?? (e instanceof ApiRequestError ? e.message : 'Erro inesperado.'));
    }
  }

  async function addSelected(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setError(null);
    const devices = s.found
      .filter((d) => selected[d.mac] !== undefined)
      .map((d) => ({
        mac: d.mac,
        ip: d.ip,
        name: selected[d.mac]!.trim() || defaultName(d),
        hostname: d.hostname,
      }));
    try {
      const r = await add.mutateAsync({ roomId: roomId === '' ? null : Number(roomId), devices });
      setSelected({});
      setMessage(
        `${r.added} computador(es) adicionado(s).` +
          (r.skipped.length > 0 ? ` ${r.skipped.length} já estava(m) cadastrado(s).` : ''),
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
    }
  }

  if (status.isPending) return <LoadingState />;
  if (status.isError)
    return <ErrorState message={status.error.message} onRetry={() => void status.refetch()} />;
  const st = status.data;
  const running = st.state === 'running';

  return (
    <section className="space-y-4">
      <nav aria-label="Trilha" className="text-sm">
        <Link to="/dispositivos" className="text-blue-800 underline">
          Dispositivos
        </Link>{' '}
        / Descobrir na rede
      </nav>
      <PageHeader title="Descobrir na rede" />
      <p className="max-w-3xl text-sm text-slate-700">
        O UniWake testa os endereços de uma rede e lista os computadores que responderam, com o MAC
        de cada um. A descoberta só enxerga as redes deste computador: máquinas em outras redes
        (VLANs) não aparecem.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void start(chosenCidr, false);
        }}
      >
        <SelectField
          label="Rede"
          value={st.subnets.some((x) => x.cidr === chosenCidr) ? chosenCidr : ''}
          onChange={(e) => setCidr(e.target.value)}
        >
          {st.subnets.length === 0 && <option value="">Nenhuma rede disponível</option>}
          {st.subnets.map((x) => (
            <option key={x.cidr} value={x.cidr}>
              {x.cidr} — {x.name} ({x.hosts} endereços)
            </option>
          ))}
        </SelectField>
        <TextField
          label="Ou parte dela"
          hint="Ex.: 10.0.3.0/24"
          value={cidr}
          onChange={(e) => setCidr(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={running || scan.isPending || !chosenCidr}>
          {running ? 'Varrendo…' : 'Varrer rede'}
        </Button>
      </form>
      <FormError message={error} />
      {message && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm">
          {message}
        </p>
      )}
      {running && (
        <p role="status" className="text-sm">
          Varrendo {st.cidr}: {st.probed} de {st.total} endereços testados…
        </p>
      )}
      {st.state === 'failed' && st.error && <FormError message={st.error} />}
      {st.state === 'done' && (
        <form onSubmit={(e) => void addSelected(e)} className="space-y-3">
          <p className="text-sm">
            {st.found.length} computador(es) responderam em {st.cidr} (
            {formatDateTime(st.finishedAt)}).
          </p>
          {st.found.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <caption className="sr-only">Computadores encontrados</caption>
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Adicionar</span>
                    </th>
                    <th scope="col" className="px-3 py-2">
                      IP
                    </th>
                    <th scope="col" className="px-3 py-2">
                      MAC
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Fabricante
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Nome na rede
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Visto
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Nome no UniWake
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {st.found.map((d) => (
                    <FoundRow
                      key={d.mac}
                      device={d}
                      name={selected[d.mac]}
                      onToggle={(on) =>
                        setSelected((cur) => {
                          const next = { ...cur };
                          if (on) next[d.mac] = defaultName(d);
                          else delete next[d.mac];
                          return next;
                        })
                      }
                      onName={(v) => setSelected((cur) => ({ ...cur, [d.mac]: v }))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {Object.keys(selected).length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <SelectField label="Sala" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Sem sala</option>
                {rooms.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </SelectField>
              <Button type="submit" variant="primary" disabled={add.isPending}>
                Adicionar {Object.keys(selected).length} selecionado(s)
              </Button>
            </div>
          )}
        </form>
      )}
      <ConfirmDialog
        open={confirmLarge !== null}
        title="Varrer uma rede grande?"
        confirmLabel="Varrer mesmo assim"
        onConfirm={() => void start(confirmLarge!, true)}
        onCancel={() => setConfirmLarge(null)}
      >
        A rede {confirmLarge} tem mais de 1.000 endereços. A varredura pode levar vários minutos e
        gera bastante tráfego. Prefira uma parte dela (por exemplo, a sala que você está
        cadastrando).
      </ConfirmDialog>
    </section>
  );
}

function FoundRow({
  device: d,
  name,
  onToggle,
  onName,
}: {
  device: DiscoveredDevice;
  name: string | undefined;
  onToggle: (on: boolean) => void;
  onName: (v: string) => void;
}) {
  const checked = name !== undefined;
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2">
        {d.registered ? (
          <span className="sr-only">Já cadastrado</span>
        ) : (
          <input
            type="checkbox"
            aria-label={`Adicionar ${d.ip}`}
            checked={checked}
            onChange={(e) => onToggle(e.target.checked)}
          />
        )}
      </td>
      <td className="px-3 py-2">{d.ip}</td>
      <td className="px-3 py-2 font-mono text-xs">
        {d.mac}
        {d.locallyAdministered && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 font-sans text-amber-900">
            MAC virtual/aleatório
          </span>
        )}
      </td>
      <td className="px-3 py-2">{d.vendor ?? '—'}</td>
      <td className="px-3 py-2">{d.hostname ?? '—'}</td>
      <td className="px-3 py-2">{formatDateTime(d.lastSeenAt)}</td>
      <td className="px-3 py-2">
        {d.registered ? (
          <Link to={`/dispositivos/${d.registered.id}`} className="text-blue-800 underline">
            já cadastrado: {d.registered.name}
          </Link>
        ) : checked ? (
          <input
            aria-label={`Nome de ${d.ip}`}
            value={name}
            maxLength={64}
            onChange={(e) => onName(e.target.value)}
            className="w-40 rounded-md border border-slate-300 px-2 py-1"
          />
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}
