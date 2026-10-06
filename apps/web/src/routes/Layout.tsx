import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { t } from '../i18n/pt-BR';

/** `admin`: only shown to administrators (FR-006.2); the server enforces it either way. */
const NAV: { to: string; label: string; end?: boolean; admin?: boolean }[] = [
  { to: '/', label: t.nav.dashboard, end: true },
  { to: '/dispositivos', label: t.nav.devices },
  { to: '/salas', label: t.nav.rooms },
  { to: '/agendamentos', label: t.nav.schedules },
  { to: '/historico', label: t.nav.history },
  { to: '/preparar', label: t.nav.prepare },
  { to: '/auditoria', label: t.nav.audit },
  { to: '/usuarios', label: t.nav.users, admin: true },
  { to: '/configuracoes', label: t.nav.settings, admin: true },
  { to: '/logs', label: t.nav.logs, admin: true },
  { to: '/saude', label: t.nav.health },
  { to: '/ajuda', label: t.nav.help },
];

export interface LayoutProps {
  banners?: ReactNode;
  userMenu?: ReactNode;
  isAdmin?: boolean;
}

/** App shell: skip link, banners, header with navigation, main landmark (constitution §8). */
export function Layout({ banners, userMenu, isAdmin = false }: LayoutProps) {
  return (
    <div className="min-h-screen">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {t.skipToContent}
      </a>
      {banners}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-lg font-bold text-blue-800">{t.appName}</span>
          <nav aria-label={t.nav.label} className="flex flex-wrap gap-1">
            {NAV.filter((item) => isAdmin || !item.admin).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? false}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-blue-100 text-blue-900' : 'text-slate-700 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">{userMenu}</div>
        </div>
      </header>
      <main id="conteudo" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
