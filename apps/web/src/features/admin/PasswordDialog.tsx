import { type FormEvent, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog } from '../../components/ui';
import { useChangeOwnPassword } from './api';

/** Trocar a própria senha (FR-006.3): ends every other session of this user (AC-006-07). */
export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <PasswordBody onClose={onClose} />;
}

function PasswordBody({ onClose }: { onClose: () => void }) {
  const change = useChangeOwnPassword();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      await change.mutateAsync({ currentPassword, newPassword });
      setDone(true);
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.code === 'VALIDATION_FAILED' &&
        Array.isArray(err.details)
      ) {
        const next: Record<string, string> = {};
        for (const d of err.details as { path?: string; message?: string }[]) {
          next[d.path ?? ''] ??= d.message ?? 'Valor inválido.';
        }
        return setErrors(next);
      }
      if (err instanceof ApiRequestError && err.code === 'PASSWORD_TOO_WEAK') {
        return setErrors({ newPassword: err.message });
      }
      setFormError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
    }
  }

  return (
    <Dialog
      open
      title="Trocar minha senha"
      onClose={onClose}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Fechar
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              type="submit"
              form="password-form"
              disabled={change.isPending}
            >
              Trocar senha
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p role="status">
          Senha trocada. Suas outras sessões (outros navegadores) foram encerradas.
        </p>
      ) : (
        <form id="password-form" onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
          <FormError message={formError} />
          <TextField
            label="Senha atual"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            error={errors.currentPassword}
            autoComplete="current-password"
          />
          <TextField
            label="Nova senha"
            type="password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            error={errors.newPassword}
            hint="Pelo menos 10 caracteres; evite senhas comuns."
            autoComplete="new-password"
          />
        </form>
      )}
    </Dialog>
  );
}
