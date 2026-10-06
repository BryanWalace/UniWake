import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { UpdateStatus } from '@uniwake/shared';
import { api, ApiRequestError } from '../../api/client';
import { useMe } from '../../auth/auth';
import { FormError } from '../../components/form';
import { Button, ConfirmDialog } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

const KEY = ['update'] as const;

/** Versions and updates (FR-001.2, FR-001.3); install buttons only for admins (AC-001-10). */
export function UpdateCard() {
  const qc = useQueryClient();
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<UpdateStatus>('/api/update'),
    refetchInterval: (q) => (q.state.data?.installing ? 5_000 : 60_000),
  });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () => api.post<UpdateStatus>('/api/update/check', {}),
    onSuccess: (s) => qc.setQueryData(KEY, s),
  });
  const install = useMutation({
    mutationFn: (override: boolean) =>
      api.post<{ version: string }>('/api/update/install', { override }),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });

  async function startInstall(override: boolean) {
    setError(null);
    setConfirming(false);
    try {
      await install.mutateAsync(override);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    }
  }

  const s = status.data;
  if (!s) return null;
  return (
    <section
      aria-labelledby="atualizacao-titulo"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="atualizacao-titulo" className="text-lg font-bold">
        Atualizações
      </h2>
      {!s.enabled ? (
        <p className="text-sm text-slate-700">
          Versão {s.current}. Este UniWake não procura atualizações (modo demonstração ou execução
          pelo código-fonte).
        </p>
      ) : (
        <>
          <p className="text-sm">
            Versão em uso: <strong>{s.current}</strong>.{' '}
            {s.available && s.latest ? (
              <strong className="text-green-800">Nova versão {s.latest.version} disponível.</strong>
            ) : (
              'Nenhuma atualização disponível.'
            )}
          </p>
          {s.error && (
            <p role="alert" className="text-sm text-red-800">
              {s.error}{' '}
              {s.lastSuccessAt !== null &&
                `Última verificação bem-sucedida: ${formatDateTime(s.lastSuccessAt)}.`}
            </p>
          )}
          <p className="text-xs text-slate-600">
            {s.lastCheckAt !== null && `Verificado em ${formatDateTime(s.lastCheckAt)}. `}
            {s.nextCheckAt !== null && `Próxima verificação: ${formatDateTime(s.nextCheckAt)}. `}
            {s.mode === 'auto'
              ? 'Instalação automática na janela de manutenção.'
              : 'Instalação manual.'}
          </p>
          {s.installing && (
            <p role="status" className="text-sm font-semibold text-blue-900">
              Instalando a versão {s.installing}: o serviço será reiniciado e o painel volta em
              alguns minutos.
            </p>
          )}
          {s.available && s.latest?.notes && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">
                Novidades da versão {s.latest.version}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{s.latest.notes}</pre>
            </details>
          )}
          <FormError message={error} />
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => check.mutate()} disabled={check.isPending}>
                {check.isPending ? 'Verificando…' : 'Verificar agora'}
              </Button>
              {s.available && s.canInstall && !s.installing && (
                <Button
                  variant="primary"
                  disabled={install.isPending}
                  onClick={() => (s.blocked ? setConfirming(true) : void startInstall(false))}
                >
                  Atualizar agora
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirming}
        title="Atualizar mesmo assim?"
        confirmLabel="Atualizar agora"
        danger
        busy={install.isPending}
        onConfirm={() => void startInstall(true)}
        onCancel={() => setConfirming(false)}
      >
        Há uma ligação em andamento ou um agendamento na próxima hora. Durante a atualização o
        UniWake fica parado por alguns minutos e pode perder esse horário.
      </ConfirmDialog>
    </section>
  );
}
