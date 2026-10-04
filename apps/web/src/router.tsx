import type { RouteObject } from 'react-router';
import { t } from './i18n/pt-BR';
import { Layout } from './routes/Layout';
import { NotFound, Placeholder } from './routes/NotFound';

/** Route table (plan §6.5). Pages are filled in by later milestones. */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
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
