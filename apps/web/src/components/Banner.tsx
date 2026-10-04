import type { ReactNode } from 'react';

export type BannerTone = 'info' | 'warning' | 'danger';

const TONES: Record<BannerTone, string> = {
  info: 'bg-blue-50 text-blue-900 border-blue-300',
  warning: 'bg-amber-50 text-amber-950 border-amber-400',
  danger: 'bg-red-50 text-red-900 border-red-400',
};

/** Persistent page-wide notice (constitution §8: dry-run, pause, update failure). */
export function Banner({ tone, children }: { tone: BannerTone; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`border-b px-4 py-2 text-sm font-medium ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="p-6 text-slate-600">
      {label}
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-4 rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="m-4 rounded-md border border-dashed border-slate-300 p-8 text-center text-slate-600">
      <p className="font-semibold text-slate-800">{title}</p>
      {children && <div className="mt-2 text-sm">{children}</div>}
    </div>
  );
}
