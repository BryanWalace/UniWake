import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { ErrorState, LoadingState } from '../../components/Banner';
import { Button, PageHeader, SelectField } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useDebounced } from '../devices/DevicesPage';

interface LogLine {
  time: string;
  level: string;
  msg: string;
  module: string | null;
  data: Record<string, unknown>;
}

const LEVEL_TONE: Record<string, string> = {
  error: 'bg-red-100 text-red-900',
  fatal: 'bg-red-100 text-red-900',
  warn: 'bg-amber-100 text-amber-900',
  info: 'bg-blue-50 text-blue-900',
  debug: 'bg-slate-100 text-slate-800',
};

/** Logs (FR-016, admin): the latest entries of the service log, newest first. */
export function LogsPage() {
  const [level, setLevel] = useState<'' | 'info' | 'warn' | 'error'>('info');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const logs = useQuery({
    queryKey: ['logs', level, q],
    queryFn: () =>
      api.get<{ entries: LogLine[]; truncated: boolean; size: number }>('/api/logs', {
        query: { level: level || undefined, q: q || undefined, limit: 500 },
      }),
    placeholderData: keepPreviousData,
  });
  return (
    <section className="space-y-4">
      <PageHeader
        title="Logs do serviço"
        actions={
          <>
            <Button onClick={() => void logs.refetch()}>Atualizar</Button>
            <a
              href="/api/logs/download"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-100"
            >
              Baixar arquivo
            </a>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3" role="search">
        <SelectField
          label="Nível mínimo"
          value={level}
          onChange={(e) => setLevel(e.target.value as typeof level)}
        >
          <option value="">Tudo (depuração)</option>
          <option value="info">Normal</option>
          <option value="warn">Avisos</option>
          <option value="error">Só erros</option>
        </SelectField>
        <label className="min-w-64 flex-1 text-sm font-medium">
          Buscar
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
      </div>
      {logs.isPending ? (
        <LoadingState />
      ) : logs.isError ? (
        <ErrorState message={logs.error.message} onRetry={() => void logs.refetch()} />
      ) : logs.data.entries.length === 0 ? (
        <p className="text-sm text-slate-700">Nenhuma entrada encontrada.</p>
      ) : (
        <>
          {logs.data.truncated && (
            <p className="text-sm text-slate-600">Mostrando só os últimos 5 MB do arquivo atual.</p>
          )}
          <ol
            className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white font-mono text-xs"
            aria-label="Entradas do log"
          >
            {logs.data.entries.map((e, i) => (
              <li key={`${e.time}-${i}`} className="flex flex-wrap gap-x-3 px-3 py-1.5">
                <span className="text-slate-600">
                  {e.time ? formatDateTime(Date.parse(e.time)) : '—'}
                </span>
                <span className={`rounded px-1.5 font-semibold ${LEVEL_TONE[e.level] ?? ''}`}>
                  {e.level}
                </span>
                {e.module && <span className="text-slate-600">[{e.module}]</span>}
                <span className="font-sans text-sm">{e.msg}</span>
                {Object.keys(e.data).length > 0 && (
                  <span className="basis-full break-all text-slate-600">
                    {JSON.stringify(e.data)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
