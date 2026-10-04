import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import type { Me } from '@uniwake/shared';
import { api, ApiRequestError } from '../api/client';
import { meQueryKey, safeNext, useMe, useSetupStatus } from '../auth/auth';
import { LoadingState } from '../components/Banner';
import { FormError, PrimaryButton, TextField } from '../components/form';

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <section className="w-full max-w-md rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <p className="text-lg font-bold text-blue-800">UniWake</p>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        <div className="mt-6">{children}</div>
      </section>
    </main>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setup = useSetupStatus();
  const me = useMe();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));

  if (setup.isPending || me.isPending) return <LoadingState />;
  if (setup.data?.needsSetup) return <Navigate to="/primeiro-acesso" replace />;
  if (me.data) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Read the form too: browser autofill may not have fired change events yet (R-M1-06).
    const form = new FormData(e.currentTarget);
    const field = (k: string) => {
      const v = form.get(k);
      return typeof v === 'string' ? v : '';
    };
    const u = username || field('username');
    const p = password || field('password');
    if (!u || !p) {
      setError('Informe usuário e senha.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await api.post<Me>('/api/auth/login', { username: u, password: p });
      qc.setQueryData(meQueryKey, user);
      await navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Entrar">
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
        <FormError message={error} />
        <TextField
          label="Usuário"
          name="username"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          label="Senha"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PrimaryButton disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</PrimaryButton>
      </form>
    </AuthCard>
  );
}
