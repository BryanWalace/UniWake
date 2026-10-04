import type { RouteObject } from 'react-router';
import { RequireAuth } from './auth/auth';
import { t } from './i18n/pt-BR';
import { LoginPage } from './routes/LoginPage';
import { NotFound, Placeholder } from './routes/NotFound';
import { SetupPage } from './routes/SetupPage';

/** Route table (plan §6.5). Pages are filled in by later milestones. */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/primeiro-acesso', element: <SetupPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <Placeholder title={t.nav.dashboard} /> },
      { path: 'dispositivos', element: <Placeholder title={t.nav.devices} /> },
      { path: 'agendamentos', element: <Placeholder title={t.nav.schedules} /> },
      { path: 'historico', element: <Placeholder title={t.nav.history} /> },
      { path: 'preparar', element: <Placeholder title={t.nav.prepare} /> },
      { path: 'configuracoes', element: <Placeholder title={t.nav.settings} /> },
      { path: 'saude', element: <Placeholder title={t.nav.health} /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
