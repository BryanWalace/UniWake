import type { RouteObject } from 'react-router';
import { RequireAuth } from './auth/auth';
import { AuditPage } from './features/admin/AuditPage';
import { HealthPage } from './features/admin/HealthPage';
import { LogsPage } from './features/admin/LogsPage';
import { SettingsPage } from './features/admin/SettingsPage';
import { UsersPage } from './features/admin/UsersPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DevicePage } from './features/devices/DevicePage';
import { DevicesPage } from './features/devices/DevicesPage';
import { PreparePage } from './features/enrollment/PreparePage';
import { ImportPage } from './features/devices/ImportPage';
import { RoomPage } from './features/rooms/RoomPage';
import { HistoryPage, JobPage } from './features/wake/HistoryPage';
import { RoomsPage } from './features/rooms/RoomsPage';
import { SchedulesPage } from './features/schedules/SchedulesPage';
import { LoginPage } from './routes/LoginPage';
import { NotFound } from './routes/NotFound';
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
      { path: 'dispositivos/:id', element: <DevicePage /> },
      { path: 'salas', element: <RoomsPage /> },
      { path: 'salas/:id', element: <RoomPage /> },
      { path: 'agendamentos', element: <SchedulesPage /> },
      { path: 'historico', element: <HistoryPage /> },
      { path: 'historico/jobs/:id', element: <JobPage /> },
      { path: 'preparar', element: <PreparePage /> },
      { path: 'configuracoes', element: <SettingsPage /> },
      { path: 'usuarios', element: <UsersPage /> },
      { path: 'auditoria', element: <AuditPage /> },
      { path: 'logs', element: <LogsPage /> },
      { path: 'saude', element: <HealthPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
