import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { JobDrawer } from './JobDrawer';
import { QuickWake } from './QuickWake';
import { type WakeIntent, WakeDialog } from './WakeDialog';

interface WakeUi {
  /** Opens the preview/confirm dialog; on start the progress drawer opens. */
  requestWake: (intent: WakeIntent) => void;
  showJob: (jobId: number) => void;
}

const Ctx = createContext<WakeUi | null>(null);

export function WakeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [intent, setIntent] = useState<WakeIntent | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const requestWake = useCallback((i: WakeIntent) => setIntent(i), []);
  const showJob = useCallback((id: number) => setJobId(id), []);
  const value = useMemo(() => ({ requestWake, showJob }), [requestWake, showJob]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <QuickWake onPick={requestWake} />
      <WakeDialog
        intent={intent}
        onClose={() => setIntent(null)}
        onStarted={(id) => {
          setIntent(null);
          setJobId(id);
          void qc.invalidateQueries({ queryKey: ['jobs'] });
        }}
      />
      {jobId !== null && <JobDrawer jobId={jobId} onClose={() => setJobId(null)} />}
    </Ctx.Provider>
  );
}

export function useWakeUi(): WakeUi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWakeUi must be used inside WakeProvider');
  return ctx;
}
