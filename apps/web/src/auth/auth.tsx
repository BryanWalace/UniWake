import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router';
import type { Me } from '@uniwake/shared';
import { api, ApiRequestError } from '../api/client';
import { ErrorState, LoadingState } from '../components/Banner';
import { t } from '../i18n/pt-BR';
import { WakeProvider } from '../features/wake/WakeProvider';
import { DemoBanner } from '../features/dashboard/DemoBanner';
import { Layout } from '../routes/Layout';

export const meQueryKey = ['auth', 'me'] as const;
export const setupStatusKey = ['auth', 'setup-status'] as const;

/** Current user, or null when not logged in (401). */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/auth/me');
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useSetupStatus() {
  return useQuery({
    queryKey: setupStatusKey,
    queryFn: () => api.get<{ needsSetup: boolean }>('/api/auth/setup-status'),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSettled: async () => {
      qc.clear();
      await navigate('/login', { replace: true });
    },
  });
}

function UserMenu({ me }: { me: Me }) {
  const logout = useLogout();
  return (
    <div className="flex items-center gap-3 text-sm">
      <span>
        <span className="font-semibold">{me.username}</span>{' '}
        <span className="text-slate-500">
          ({me.role === 'admin' ? t.user.roleAdmin : t.user.roleOperator})
        </span>
      </span>
      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100"
      >
        {t.user.logout}
      </button>
    </div>
  );
}

/** Guards every panel page: first run → setup, no session → login (FR-006.1). */
export function RequireAuth() {
  const location = useLocation();
  const setup = useSetupStatus();
  const me = useMe();

  if (setup.isPending || me.isPending) return <LoadingState />;
  if (setup.isError)
    return <ErrorState message={setup.error.message} onRetry={() => void setup.refetch()} />;
  if (setup.data.needsSetup) return <Navigate to="/primeiro-acesso" replace />;
  if (me.isError)
    return <ErrorState message={me.error.message} onRetry={() => void me.refetch()} />;
  if (!me.data) {
    const next = location.pathname + location.search;
    return (
      <Navigate to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
    );
  }
  return (
    <WakeProvider>
      <Layout banners={<DemoBanner />} userMenu={<UserMenu me={me.data} />} />
    </WakeProvider>
  );
}

/** Only allow same-app relative paths as redirect targets (no open redirect). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
