import { type FormEvent, useState } from 'react';
import type { Role, User } from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { ErrorState, LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog, PageHeader, SelectField } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useResetPassword, useSaveUser, useUsers } from './api';

const ROLE_TEXT: Record<Role, string> = { admin: 'Administrador', operator: 'Operador' };

/** Usuários (FR-006.2, admin only). */
export function UsersPage() {
  const users = useUsers();
  const save = useSaveUser();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(u: User, data: { role?: Role; enabled?: boolean }, done: string) {
    setError(null);
    try {
      await save.mutateAsync({ id: u.id, data });
      setMessage(done);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Erro inesperado.');
    }
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Usuários"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Novo usuário
          </Button>
        }
      />
      {message && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm">
          {message}
        </p>
      )}
      <FormError message={error} />
      {users.isPending ? (
        <LoadingState />
      ) : users.isError ? (
        <ErrorState message={users.error.message} onRetry={() => void users.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Usuários</caption>
            <thead className="bg-slate-50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Usuário
                </th>
                <th scope="col" className="px-3 py-2">
                  Perfil
                </th>
                <th scope="col" className="px-3 py-2">
                  Situação
                </th>
                <th scope="col" className="px-3 py-2">
                  Senha trocada em
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{u.username}</td>
                  <td className="px-3 py-2">{ROLE_TEXT[u.role]}</td>
                  <td className="px-3 py-2">{u.enabled ? 'Ativo' : 'Desativado'}</td>
                  <td className="px-3 py-2">{formatDateTime(u.passwordChangedAt)}</td>
                  <td className="flex flex-wrap gap-2 px-3 py-2">
                    <Button
                      variant="ghost"
                      aria-label={`${u.role === 'admin' ? 'Tornar operador' : 'Tornar administrador'}: ${u.username}`}
                      onClick={() =>
                        void update(
                          u,
                          { role: u.role === 'admin' ? 'operator' : 'admin' },
                          `${u.username} agora é ${u.role === 'admin' ? 'operador' : 'administrador'}.`,
                        )
                      }
                    >
                      {u.role === 'admin' ? 'Tornar operador' : 'Tornar administrador'}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`${u.enabled ? 'Desativar' : 'Ativar'} ${u.username}`}
                      onClick={() =>
                        void update(
                          u,
                          { enabled: !u.enabled },
                          `${u.username} ${u.enabled ? 'desativado' : 'ativado'}.`,
                        )
                      }
                    >
                      {u.enabled ? 'Desativar' : 'Ativar'}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Redefinir senha de ${u.username}`}
                      onClick={() => setResetting(u)}
                    >
                      Redefinir senha
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(u) => {
            setCreating(false);
            setMessage(`Usuário ${u.username} criado.`);
          }}
        />
      )}
      {resetting && (
        <ResetPasswordDialog
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={() => {
            setMessage(
              `Senha de ${resetting.username} redefinida; as sessões dele foram encerradas.`,
            );
            setResetting(null);
          }}
        />
      )}
    </section>
  );
}

function fieldErrors(err: unknown): { fields: Record<string, string>; form: string | null } {
  if (err instanceof ApiRequestError) {
    if (err.code === 'VALIDATION_FAILED' && Array.isArray(err.details)) {
      const fields: Record<string, string> = {};
      for (const d of err.details as { path?: string; message?: string }[]) {
        fields[(d.path ?? '').split('.')[0] ?? ''] ??= d.message ?? 'Valor inválido.';
      }
      return { fields, form: null };
    }
    if (err.code === 'PASSWORD_TOO_WEAK') return { fields: { password: err.message }, form: null };
    if (err.code === 'USERNAME_DUPLICATE') return { fields: { username: err.message }, form: null };
    return { fields: {}, form: err.message };
  }
  return { fields: {}, form: 'Erro inesperado.' };
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (u: User) => void;
}) {
  const save = useSaveUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      onCreated(await save.mutateAsync({ data: { username, password, role } }));
    } catch (err) {
      const r = fieldErrors(err);
      setErrors(r.fields);
      setFormError(r.form);
    }
  }

  return (
    <Dialog
      open
      title="Novo usuário"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="user-form" disabled={save.isPending}>
            Criar
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
        <FormError message={formError} />
        <TextField
          label="Usuário"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={errors.username}
          autoComplete="off"
        />
        <TextField
          label="Senha inicial"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="Pelo menos 10 caracteres; evite senhas comuns."
          autoComplete="new-password"
        />
        <SelectField label="Perfil" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="operator">Operador</option>
          <option value="admin">Administrador</option>
        </SelectField>
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: User;
  onClose: () => void;
  onDone: () => void;
}) {
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      await reset.mutateAsync({ id: user.id, newPassword: password });
      onDone();
    } catch (err) {
      const r = fieldErrors(err);
      setError(r.fields.newPassword ?? r.fields.password ?? r.form ?? undefined);
    }
  }

  return (
    <Dialog
      open
      title={`Redefinir senha de ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="reset-form" disabled={reset.isPending}>
            Redefinir
          </Button>
        </>
      }
    >
      <form id="reset-form" onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          label="Nova senha"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
          hint="As sessões abertas desse usuário serão encerradas."
          autoComplete="new-password"
        />
      </form>
    </Dialog>
  );
}
