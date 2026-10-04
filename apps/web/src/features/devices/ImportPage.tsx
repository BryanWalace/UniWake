import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api/client';
import { keys } from '../../api/hooks';
import { FormError } from '../../components/form';
import { Button, PageHeader } from '../../components/ui';
import { CSV_TEMPLATE, readCsvFile } from './csv-file';

type RowStatus = 'create' | 'update' | 'skip' | 'error';
interface PreviewRow {
  line: number;
  status: RowStatus;
  name: string;
  mac: string;
  room: string | null;
  reasons: string[];
}
interface Preview {
  rows: PreviewRow[];
  summary: Record<RowStatus, number>;
  roomsToCreate: string[];
  tagsToCreate: string[];
  ignoredColumns: string[];
}
interface Result {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  roomsCreated: string[];
  tagsCreated: string[];
}

const STATUS_TEXT: Record<RowStatus, string> = {
  create: 'Criar',
  update: 'Atualizar',
  skip: 'Ignorar',
  error: 'Erro',
};
const STATUS_STYLE: Record<RowStatus, string> = {
  create: 'bg-green-100 text-green-900',
  update: 'bg-blue-100 text-blue-900',
  skip: 'bg-slate-200 text-slate-800',
  error: 'bg-red-100 text-red-900',
};

/** CSV import wizard (FR-002.3): file → preview (nothing written) → import. */
export function ImportPage() {
  const qc = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip');
  const [createMissing, setCreateMissing] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = { onDuplicate, createMissing };

  async function onFile(file: File | undefined) {
    setPreview(null);
    setResult(null);
    setError(null);
    if (!file) return;
    const { text, encoding } = await readCsvFile(file);
    setCsv(text);
    setFileInfo(`${file.name} (${encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252, convertido'})`);
  }

  async function run<T>(path: string, done: (r: T) => void) {
    if (csv === null) return;
    setBusy(true);
    setError(null);
    try {
      done(await api.post<T>(path, { csv, ...options }));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    } finally {
      setBusy(false);
    }
  }

  const toApply = preview ? preview.summary.create + preview.summary.update : 0;

  return (
    <section className="space-y-5">
      <nav aria-label="Trilha" className="text-sm">
        <Link to="/dispositivos" className="text-blue-800 underline">
          Dispositivos
        </Link>{' '}
        / Importar CSV
      </nav>
      <PageHeader title="Importar dispositivos (CSV)" />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-700">
          Colunas: <code>nome; mac; ip; hostname; sala; tags; observacoes; ativo</code>. Etiquetas
          separadas por
          <code> | </code>. Arquivos do Excel (ponto e vírgula, com ou sem acentos) são aceitos.{' '}
          <a
            className="text-blue-800 underline"
            download="modelo-uniwake.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`}
          >
            Baixar modelo
          </a>
        </p>
        <label className="mt-3 block text-sm font-medium" htmlFor="csv-file">
          Arquivo CSV
        </label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          className="mt-1 block"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {fileInfo && <p className="mt-1 text-sm text-slate-600">{fileInfo}</p>}

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">MAC que já está cadastrado</legend>
          <label className="mr-4 inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="dup"
              checked={onDuplicate === 'skip'}
              onChange={() => setOnDuplicate('skip')}
            />
            Ignorar a linha
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="dup"
              checked={onDuplicate === 'update'}
              onChange={() => setOnDuplicate('update')}
            />
            Atualizar o dispositivo
          </label>
        </fieldset>
        <label className="mt-2 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={createMissing}
            onChange={(e) => setCreateMissing(e.target.checked)}
          />
          Criar salas e etiquetas que não existem
        </label>

        <div className="mt-4 flex gap-2">
          <Button
            variant="primary"
            disabled={csv === null || busy}
            onClick={() =>
              void run<Preview>('/api/devices/import/preview', (p) => {
                setPreview(p);
                setResult(null);
              })
            }
          >
            Pré-visualizar
          </Button>
        </div>
      </div>

      <FormError message={error} />

      {preview && !result && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold">Pré-visualização (nada foi gravado ainda)</h2>
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Resumo">
            {(Object.keys(STATUS_TEXT) as RowStatus[]).map((s) => (
              <li key={s} className={`rounded-full px-3 py-1 font-semibold ${STATUS_STYLE[s]}`}>
                {STATUS_TEXT[s]}: {preview.summary[s]}
              </li>
            ))}
          </ul>
          {preview.roomsToCreate.length > 0 && (
            <p className="text-sm">Salas novas: {preview.roomsToCreate.join(', ')}</p>
          )}
          {preview.tagsToCreate.length > 0 && (
            <p className="text-sm">Etiquetas novas: {preview.tagsToCreate.join(', ')}</p>
          )}
          {preview.ignoredColumns.length > 0 && (
            <p className="text-sm text-slate-600">
              Colunas ignoradas: {preview.ignoredColumns.join(', ')}
            </p>
          )}
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Linhas do arquivo</caption>
              <thead className="sticky top-0 bg-slate-50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Linha
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Ação
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Nome
                  </th>
                  <th scope="col" className="px-3 py-2">
                    MAC
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Sala
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Observação
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="px-3 py-2">{r.line}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                      >
                        {STATUS_TEXT[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 font-mono">{r.mac}</td>
                    <td className="px-3 py-2">{r.room ?? '—'}</td>
                    <td className="px-3 py-2">{r.reasons.join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            variant="primary"
            disabled={toApply === 0 || busy}
            onClick={() =>
              void run<Result>('/api/devices/import/commit', (r) => {
                setResult(r);
                void qc.invalidateQueries({ queryKey: keys.devicesAll });
                void qc.invalidateQueries({ queryKey: keys.rooms });
                void qc.invalidateQueries({ queryKey: keys.tags });
              })
            }
          >
            Importar {toApply} dispositivo(s)
          </Button>
        </div>
      )}

      {result && (
        <div role="status" className="rounded-lg border border-green-300 bg-green-50 p-4">
          <p className="font-semibold">Importação concluída.</p>
          <p className="text-sm">
            Criados: {result.created} · Atualizados: {result.updated} · Ignorados: {result.skipped}{' '}
            · Com erro: {result.errors}
          </p>
          {result.roomsCreated.length > 0 && (
            <p className="text-sm">Salas criadas: {result.roomsCreated.join(', ')}</p>
          )}
          {result.tagsCreated.length > 0 && (
            <p className="text-sm">Etiquetas criadas: {result.tagsCreated.join(', ')}</p>
          )}
          <Link to="/dispositivos" className="mt-2 inline-block text-blue-800 underline">
            Ver dispositivos
          </Link>
        </div>
      )}
    </section>
  );
}
