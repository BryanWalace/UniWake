import { useState } from 'react';
import { ErrorState, LoadingState } from '../../components/Banner';
import { Button, PageHeader, SelectField } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useDebounced } from '../devices/DevicesPage';
import { type AuditFilters, auditQuery, useAudit } from './api';

const ACTIONS = [
  { value: '', label: 'Todas' },
  { value: 'wake.', label: 'Ligações' },
  { value: 'auth.', label: 'Login e senhas' },
  { value: 'device.', label: 'Dispositivos' },
  { value: 'room.', label: 'Salas' },
  { value: 'tag.', label: 'Etiquetas' },
  { value: 'schedule', label: 'Agendamentos' },
  { value: 'user.', label: 'Usuários' },
  { value: 'settings.', label: 'Configurações' },
];
const RESULT_TEXT = { ok: 'ok', error: 'erro', denied: 'negado' } as const;

/** "YYYY-MM-DD" (local) → epoch ms at local midnight. */
const dayStart = (v: string) => (v ? new Date(`${v}T00:00:00`).getTime() : undefined);

/** Auditoria (FR-006.5): filters, pages and CSV export. */
export function AuditPage() {
  const [action, setAction] = useState('');
  const [result, setResult] = useState<'' | 'ok' | 'error' | 'denied'>('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(text.trim(), 300);
  const toMs = dayStart(to);
  const filters: AuditFilters = {
    action,
    ...(result ? { result } : {}),
    q,
    ...(from ? { from: dayStart(from)! } : {}),
    ...(toMs !== undefined ? { to: toMs + 86_400_000 } : {}),
  };
  const audit = useAudit(filters, page);
  const exportHref = `/api/audit/export.csv?${new URLSearchParams(
    Object.entries(auditQuery(filters))
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString()}`;

  return (
    <section className="space-y-4">
      <PageHeader
        title="Auditoria"
        actions={
          <a
            href={exportHref}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-100"
          >
            Exportar CSV
          </a>
        }
      />
      <div
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5"
        role="search"
      >
        <SelectField
          label="Assunto"
          value={action}
          onChange={(e) => (setAction(e.target.value), setPage(1))}
        >
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Resultado"
          value={result}
          onChange={(e) => (setResult(e.target.value as typeof result), setPage(1))}
        >
          <option value="">Todos</option>
          <option value="ok">ok</option>
          <option value="error">erro</option>
          <option value="denied">negado</option>
        </SelectField>
        <label className="text-sm font-medium">
          Usuário ou alvo
          <input
            type="search"
            value={text}
            onChange={(e) => (setText(e.target.value), setPage(1))}
            maxLength={100}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
        <label className="text-sm font-medium">
          De
          <input
            type="date"
            value={from}
            onChange={(e) => (setFrom(e.target.value), setPage(1))}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
        <label className="text-sm font-medium">
          Até
          <input
            type="date"
            value={to}
            onChange={(e) => (setTo(e.target.value), setPage(1))}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
      </div>
      {audit.isPending ? (
        <LoadingState />
      ) : audit.isError ? (
        <ErrorState message={audit.error.message} onRetry={() => void audit.refetch()} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Registros de auditoria</caption>
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Quando
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Usuário
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Ação
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Alvo
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Resultado
                  </th>
                  <th scope="col" className="px-3 py-2">
                    IP
                  </th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(a.at)}</td>
                    <td className="px-3 py-2">{a.actorLabel}</td>
                    <td className="px-3 py-2 font-mono">{a.action}</td>
                    <td className="px-3 py-2">{a.target ?? '—'}</td>
                    <td className="px-3 py-2">{RESULT_TEXT[a.result]}</td>
                    <td className="px-3 py-2 font-mono">{a.sourceIp ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Anteriores
            </Button>
            <span>
              {audit.data.total} registro(s) · página {page} de{' '}
              {Math.max(1, Math.ceil(audit.data.total / 50))}
            </span>
            <Button disabled={page * 50 >= audit.data.total} onClick={() => setPage((p) => p + 1)}>
              Seguintes
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
