import { Link } from 'react-router';
import type { TeamConflict } from '@uniwake/shared';
import { EmptyState, ErrorState, LoadingState } from '../../components/Banner';
import { PageHeader } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useConflicts } from './api';

const KIND: Record<TeamConflict['kind'], string> = {
  concurrent: 'Editado nos dois PCs',
  duplicate_mac: 'Mesma máquina cadastrada duas vezes (MAC)',
  duplicate_name: 'Nome repetido',
};

const ENTITY: Record<string, string> = {
  room: 'Sala',
  tag: 'Etiqueta',
  device: 'Máquina',
  schedule: 'Agendamento',
  schedule_exception: 'Exceção',
  schedule_run: 'Execução',
  user: 'Usuário',
  setting: 'Configuração',
  scheduler_pause: 'Pausa',
  team_member: 'PC da equipe',
};

/** Short pt-BR summary of a version: its name-like fields. */
function summary(v: unknown): string {
  if (v === null || typeof v !== 'object') return '—';
  const o = v as Record<string, unknown>;
  const parts = ['name', 'username', 'code', 'mac', 'description', 'value']
    .filter((k) => o[k] !== undefined)
    .map(
      (k) =>
        `${String(k === 'value' ? 'valor' : k)}: ${typeof o[k] === 'string' ? o[k] : JSON.stringify(o[k])}`,
    );
  return parts.length > 0 ? parts.join(' · ') : 'outros campos';
}

/** FR-203: what last-writer-wins and the duplicate rules decided, so people can fix names by hand. */
export function ConflictsPage() {
  const q = useConflicts();
  return (
    <div className="space-y-4">
      <PageHeader title="Conflitos resolvidos" />
      <p className="max-w-3xl text-slate-700">
        Quando o mesmo item é alterado em dois PCs da equipe antes de sincronizarem, vale a
        alteração mais recente em todos os PCs. Os casos abaixo mostram o que foi mantido e o que
        foi descartado.{' '}
        <Link to="/equipe" className="text-blue-800 underline">
          Voltar ao Modo equipe
        </Link>
      </p>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="Nenhum conflito até agora." />
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">O que houve</th>
                <th className="px-3 py-2">Mantido</th>
                <th className="px-3 py-2">Descartado</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{formatDateTime(c.at)}</td>
                  <td className="px-3 py-2">
                    {ENTITY[c.entity] ?? c.entity}: {c.label.replace(/^[a-z_]+: ?/, '')}
                  </td>
                  <td className="px-3 py-2">{KIND[c.kind]}</td>
                  <td className="px-3 py-2">{summary(c.kept)}</td>
                  <td className="px-3 py-2 text-slate-600">{summary(c.discarded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
