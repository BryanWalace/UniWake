import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { LIMITS, type Me } from '@uniwake/shared';
import { api, ApiRequestError } from '../api/client';
import { meQueryKey, setupStatusKey, useSetupStatus } from '../auth/auth';
import { LoadingState } from '../components/Banner';
import { FormError, PrimaryButton, TextField } from '../components/form';
import { AuthCard } from './LoginPage';

/** First run (FR-006.1): create the admin account. Only works on the UniWake computer itself. */
export function SetupPage() {
  const setup = useSetupStatus();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (setup.isPending) return <LoadingState />;
  if (setup.data && !setup.data.needsSetup) return <Navigate to="/login" replace />;

  const tooShort = password.length > 0 && password.length < LIMITS.passwordMin;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < LIMITS.passwordMin || password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/setup', { username, password });
      const me = await api.post<Me>('/api/auth/login', { username, password });
      qc.setQueryData(setupStatusKey, { needsSetup: false });
      qc.setQueryData(meQueryKey, me);
      await navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Primeiro acesso">
      <p className="mb-4 text-slate-700">
        Crie a conta de administrador. Ela poderá cadastrar outros usuários e alterar as
        configurações. Este passo só funciona neste computador.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
        <FormError message={error} />
        <TextField
          label="Usuário do administrador"
          name="username"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          hint="Letras minúsculas, números, ponto, hífen ou sublinhado."
        />
        <TextField
          label="Senha"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`Pelo menos ${LIMITS.passwordMin} caracteres. Evite senhas comuns.`}
          error={
            tooShort ? `A senha precisa de pelo menos ${LIMITS.passwordMin} caracteres.` : undefined
          }
        />
        <TextField
          label="Confirme a senha"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? 'As senhas não conferem.' : undefined}
        />
        <PrimaryButton disabled={busy || tooShort || mismatch || !password || !confirm}>
          {busy ? 'Criando…' : 'Criar administrador'}
        </PrimaryButton>
      </form>
    </AuthCard>
  );
}
