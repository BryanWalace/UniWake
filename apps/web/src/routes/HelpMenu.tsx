import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router';
import type { UpdateStatus } from '@uniwake/shared';
import { api } from '../api/client';
import { t } from '../i18n/pt-BR';

export const REPO_URL = 'https://github.com/BryanWalace/UniWake';

/** FR-207: GitHub's new-issue page with the matching form and the version pre-filled. */
export function issueUrl(
  template: 'bug_report.yml' | 'feature_request.yml',
  version: string | null,
): string {
  const q = new URLSearchParams({ template });
  if (version) q.set('version', version);
  return `${REPO_URL}/issues/new?${q.toString()}`;
}

/** "Ajuda" menu: help pages, report a problem, suggest a feature (FR-206, FR-207). */
export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const version =
    useQuery({
      queryKey: ['update'],
      queryFn: () => api.get<UpdateStatus>('/api/update'),
      staleTime: 5 * 60_000,
    }).data?.current ?? null;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const item = 'block rounded-md px-3 py-2 text-sm text-slate-800 hover:bg-slate-100';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        {t.nav.help} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-md bg-white p-1 shadow-lg ring-1 ring-slate-200">
          <NavLink to="/ajuda" className={item} onClick={() => setOpen(false)}>
            Central de ajuda
          </NavLink>
          <NavLink to="/ajuda/team-mode" className={item} onClick={() => setOpen(false)}>
            Modo equipe
          </NavLink>
          <a
            className={item}
            href={issueUrl('bug_report.yml', version)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Relatar problema
          </a>
          <a
            className={item}
            href={issueUrl('feature_request.yml', version)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Sugerir função
          </a>
        </div>
      )}
    </div>
  );
}
