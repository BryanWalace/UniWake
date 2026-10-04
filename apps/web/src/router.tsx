import type { RouteObject } from 'react-router';
import { RequireAuth } from './auth/auth';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DevicesPage } from './features/devices/DevicesPage';
import { ImportPage } from './features/devices/ImportPage';
import { RoomPage } from './features/rooms/RoomPage';
import { HistoryPage, JobPage } from './features/wake/HistoryPage';
import { RoomsPage } from './features/rooms/RoomsPage';
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
      { index: true, element: <DashboardPage /> },
      { path: 'dispositivos', element: <DevicesPage /> },
      { path: 'dispositivos/importar', element: <ImportPage /> },
      { path: 'salas', element: <RoomsPage /> },
      { path: 'salas/:id', element: <RoomPage /> },
      { path: 'agendamentos', element: <Placeholder title={t.nav.schedules} /> },
      { path: 'historico', element: <HistoryPage /> },
      { path: 'historico/jobs/:id', element: <JobPage /> },
      { path: 'preparar', element: <Placeholder title={t.nav.prepare} /> },
      { path: 'configuracoes', element: <Placeholder title={t.nav.settings} /> },
      { path: 'saude', element: <Placeholder title={t.nav.health} /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
