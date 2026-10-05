import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  TEST_WOL_ACTIVE_STATES,
  TEST_WOL_STATE_LABEL,
  type TestWolRun,
  type TestWolState,
} from '@uniwake/shared';
import { api, ApiRequestError } from '../../api/client';
import { FormError } from '../../components/form';
import { Button, Dialog } from '../../components/ui';
import { formatTime } from '../../lib/format';

const POLL_MS = 2_000;
const isActive = (s: TestWolState) => TEST_WOL_ACTIVE_STATES.includes(s);

function useTestWolRun(id: number | null) {
  return useQuery({
    queryKey: ['test-wol', id] as const,
    queryFn: () => api.get<TestWolRun>(`/api/test-wol/${id}`),
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data && !isActive(q.state.data.state) ? false : POLL_MS),
  });
}

/** "Testar WoL desta máquina" (FR-007.4): a guided test with live progress. */
export function TestWolDialog({
  deviceId,
  deviceName,
  open,
  onClose,
}: {
  deviceId: number;
  deviceName: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [runId, setRunId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useTestWolRun(runId);
  const start = useMutation({
    mutationFn: () => api.post<TestWolRun>(`/api/devices/${deviceId}/test-wol`, {}),
    onSuccess: (r) => {
      qc.setQueryData(['test-wol', r.id], r);
      setRunId(r.id);
    },
  });
  const cancel = useMutation({
    mutationFn: (id: number) => api.post<TestWolRun>(`/api/test-wol/${id}/cancel`, {}),
    onSuccess: (r) => qc.setQueryData(['test-wol', r.id], r),
  });
  const r = run.data;

  async function begin() {
    setError(null);
    try {
      await start.mutateAsync();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    }
  }

  function close() {
    setRunId(null);
    setError(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      title={`Testar WoL: ${deviceName}`}
      onClose={close}
      footer={
        r && isActive(r.state) ? (
          <Button variant="danger" onClick={() => cancel.mutate(r.id)} disabled={cancel.isPending}>
            Cancelar teste
          </Button>
        ) : !r ? (
          <>
            <Button onClick={close}>Fechar</Button>
            <Button variant="primary" onClick={() => void begin()} disabled={start.isPending}>
              Começar teste
            </Button>
          </>
        ) : (
          <Button onClick={close}>Fechar</Button>
        )
      }
    >
      {!r ? (
        <div className="space-y-2 text-sm">
          <p>O UniWake vai conferir se esta máquina liga pela rede:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Depois de começar, desligue a máquina pelo menu Iniciar → Desligar.</li>
            <li>Quando ela parar de responder, o UniWake espera mais 30 segundos.</li>
            <li>Envia o Magic Packet e aguarda a máquina ligar.</li>
          </ol>
          <FormError message={error} />
        </div>
      ) : (
        <Progress run={r} />
      )}
    </Dialog>
  );
}

function Progress({ run: r }: { run: TestWolRun }) {
  const steps = [
    { done: r.offlineAt !== null, text: 'Máquina desligada', at: r.offlineAt },
    { done: r.sentAt !== null, text: 'Magic Packet enviado', at: r.sentAt },
  ];
  const final = !isActive(r.state);
  return (
    <div className="space-y-3 text-sm">
      <p role="status" aria-live="polite" className="font-semibold">
        {TEST_WOL_STATE_LABEL[r.state]}
        {r.state === 'aguardando_desligar' && ': desligue a máquina pelo menu Iniciar.'}
        {r.state === 'aguardando_placa' && ' (30 segundos).'}
      </p>
      <ul className="space-y-1">
        {steps.map((s) => (
          <li key={s.text}>
            <span aria-hidden="true">{s.done ? '✓' : '○'}</span> {s.text}
            {s.at !== null && ` às ${formatTime(s.at)}`}
          </li>
        ))}
      </ul>
      {final && r.detail && <p>{r.detail}</p>}
      {r.state === 'nao_acordou' && (
        <p>
          Confira a BIOS (Wake on LAN ativado, ErP desativado) e a{' '}
          <Link to="/preparar" className="text-blue-800 underline">
            preparação da máquina
          </Link>
          .
        </p>
      )}
      {r.jobId !== null && (
        <p>
          <Link to={`/historico/jobs/${r.jobId}`} className="text-blue-800 underline">
            Ver a ligação no histórico
          </Link>
        </p>
      )}
    </div>
  );
}
