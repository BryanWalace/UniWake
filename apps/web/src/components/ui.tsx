/**
 * Small accessible UI primitives (constitution §8): visible focus, labels, ≥ 44 px primary
 * targets, keyboard-operable dialogs.
 */
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import type { DeviceStatus } from '@uniwake/shared';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-blue-700 text-white hover:bg-blue-800 border-transparent',
  secondary: 'bg-white text-slate-800 hover:bg-slate-100 border-slate-300',
  danger: 'bg-red-700 text-white hover:bg-red-800 border-transparent',
  ghost: 'bg-transparent text-blue-800 hover:bg-blue-50 border-transparent',
};

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function SelectField({
  label,
  children,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <select
        id={id}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base"
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  online: 'Ligado',
  offline: 'Desligado',
  desconhecido: 'Desconhecido',
};

const STATUS_STYLE: Record<DeviceStatus, string> = {
  online: 'bg-green-100 text-green-900 ring-green-600/30',
  offline: 'bg-slate-200 text-slate-800 ring-slate-500/30',
  desconhecido: 'bg-amber-50 text-amber-900 ring-amber-600/30',
};

const STATUS_DOT: Record<DeviceStatus, string> = {
  online: 'bg-green-600',
  offline: 'bg-slate-500',
  desconhecido: 'bg-amber-500',
};

/** Status is conveyed by text, not only colour (WCAG 1.4.1). */
export function StatusBadge({ status }: { status: DeviceStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
      <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}

export function PageHeader({
  title,
  actions,
  level = 1,
}: {
  title: string;
  actions?: ReactNode;
  /** One h1 per page; secondary sections use 2. */
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <Heading className={level === 1 ? 'text-2xl font-bold' : 'text-xl font-bold'}>
        {title}
      </Heading>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Modal dialog: role=dialog, aria-modal, labelled by its title, Escape closes, focus moves into
 * the dialog and returns to the previously focused element on close.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-close])',
    );
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`mt-12 w-full rounded-xl bg-white shadow-xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-slate-800">{children}</div>
    </Dialog>
  );
}
