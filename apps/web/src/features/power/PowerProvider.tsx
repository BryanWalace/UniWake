import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PowerDialog, type PowerIntent } from './PowerDialog';
import { PowerDrawer } from './PowerDrawer';

interface PowerUi {
  /** Opens the preview/confirm dialog; on start the progress drawer opens (FR-305). */
  requestPower: (intent: PowerIntent) => void;
  showPowerJob: (jobId: number) => void;
}

const Ctx = createContext<PowerUi | null>(null);

export function PowerProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [intent, setIntent] = useState<PowerIntent | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const requestPower = useCallback((i: PowerIntent) => setIntent(i), []);
  const showPowerJob = useCallback((id: number) => setJobId(id), []);
  const value = useMemo(() => ({ requestPower, showPowerJob }), [requestPower, showPowerJob]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <PowerDialog
        intent={intent}
        onClose={() => setIntent(null)}
        onStarted={(id) => {
          setIntent(null);
          setJobId(id);
          void qc.invalidateQueries({ queryKey: ['power'] });
        }}
      />
      {jobId !== null && <PowerDrawer jobId={jobId} onClose={() => setJobId(null)} />}
    </Ctx.Provider>
  );
}

export function usePowerUi(): PowerUi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePowerUi must be used inside PowerProvider');
  return ctx;
}
