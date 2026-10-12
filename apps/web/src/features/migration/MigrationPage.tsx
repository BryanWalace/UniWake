import { type FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  EXPORT_SECTION_INFO,
  EXPORT_SECTIONS,
  type ExportSection,
  type ImportInspect,
  type ImportMode,
  type ImportPreview,
} from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { ErrorState, LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, Dialog, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { HelpLink } from '../help/HelpPage';
import {
  activateStandby,
  applyImport,
  exportFile,
  inspectFile,
  previewImport,
  saveFile,
  undoImport,
  useMigrationState,
} from './api';

const errorText = (e: unknown) =>
  e instanceof ApiRequestError ? e.message : 'Erro inesperado. Tente de novo.';

/** "Backup e migração" (spec §6c): export, import with preview, standby and undo. */
export function MigrationPage() {
  return (
    <section className="space-y-6">
      <PageHeader title="Backup e migração" />
      <p className="max-w-3xl text-sm text-slate-700">
        Leve o cadastro do UniWake para outro PC ou guarde uma cópia fora deste computador num
        arquivo <code>.uniwake</code>. Os backups automáticos do banco (em Configurações) continuam
        valendo para restaurar este mesmo PC.{' '}
        <HelpLink topic="backup-migration">Como funciona</HelpLink>
      </p>
      <StateSection />
      <ExportSection />
      <ImportSection />
    </section>
  );
}

// ----------------------------------------------------------------------------- state

function StateSection() {
  const q = useMigrationState();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'activate' | 'undo' | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  const s = q.data;
  if (!s.standby && !s.lastImport && !s.lastAutoExport && !done) return null;
  const word = dialog === 'activate' ? 'ATIVAR' : 'DESFAZER';

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (dialog === 'activate') {
        await activateStandby();
        setDone('Este UniWake está ativo: os agendamentos voltaram a valer.');
      } else {
        await undoImport();
        setDone(
          'O backup de antes da importação será restaurado. O serviço reinicia em instantes.',
        );
      }
      setDialog(null);
      setTyped('');
      await qc.invalidateQueries();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="estado"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="estado" className="text-lg font-bold">
        Situação
      </h2>
      {done && (
        <p role="status" className="text-sm text-green-800">
          {done}
        </p>
      )}
      {s.standby && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
          <p>
            <strong>Em espera</strong> desde {formatDateTime(s.standby.since)}, depois de importar o
            arquivo de <strong>{s.standby.from}</strong>. Os agendamentos estão parados e as
            máquinas dos laboratórios não recebem ordens deste PC. Confira os dados e, quando o PC
            antigo estiver desligado, ative.
          </p>
          <Button variant="primary" className="mt-2" onClick={() => setDialog('activate')}>
            Ativar este UniWake
          </Button>
        </div>
      )}
      {s.lastImport && (
        <div className="text-sm">
          <p>
            Última importação: {formatDateTime(s.lastImport.at)}, de {s.lastImport.from} (
            {s.lastImport.mode === 'merge' ? 'mesclar' : 'substituir'}).
          </p>
          {s.lastImport.backupId !== null && (
            <Button className="mt-2" onClick={() => setDialog('undo')}>
              Desfazer importação
            </Button>
          )}
        </div>
      )}
      {s.lastAutoExport && (
        <p className="text-sm">
          Última exportação automática: {formatDateTime(s.lastAutoExport.at)} —{' '}
          {s.lastAutoExport.ok
            ? `ok (${s.lastAutoExport.file ?? ''})`
            : `falhou: ${s.lastAutoExport.error ?? ''}`}
        </p>
      )}
      <Dialog
        open={dialog !== null}
        title={dialog === 'activate' ? 'Ativar este UniWake?' : 'Desfazer a importação?'}
        onClose={() => {
          setDialog(null);
          setTyped('');
        }}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancelar</Button>
            <Button
              variant={dialog === 'undo' ? 'danger' : 'primary'}
              disabled={typed.trim() !== word || busy}
              onClick={() => void confirm()}
            >
              {dialog === 'activate' ? 'Ativar' : 'Desfazer'}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {dialog === 'activate'
            ? 'Os agendamentos voltam a ligar e desligar as máquinas a partir deste PC. Desligue antes o PC antigo, se ele ainda estiver com o UniWake.'
            : 'O banco volta a como estava antes da importação. Tudo o que foi alterado depois dela também é desfeito. O serviço reinicia.'}
        </p>
        <TextField
          label={`Digite ${word} para confirmar`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-3"
        />
        <FormError message={error} />
      </Dialog>
    </section>
  );
}

// ----------------------------------------------------------------------------- export

function ExportSection() {
  const [chosen, setChosen] = useState<ExportSection[]>(
    EXPORT_SECTIONS.filter((s) => EXPORT_SECTION_INFO[s].default),
  );
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const needsPassword = chosen.some((s) => EXPORT_SECTION_INFO[s].secret);

  function toggle(s: ExportSection) {
    setChosen((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));
    setSaved(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    if (chosen.length === 0) return setError('Escolha pelo menos uma parte.');
    if (needsPassword && password.length < 10)
      return setError('Use uma senha com pelo menos 10 caracteres.');
    if (needsPassword && password !== again) return setError('As duas senhas não são iguais.');
    setBusy(true);
    try {
      const { blob, fileName } = await exportFile({
        sections: chosen,
        ...(needsPassword ? { password } : {}),
      });
      saveFile(blob, fileName);
      setSaved(fileName);
      setPassword('');
      setAgain('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="exportar" className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 id="exportar" className="mb-3 text-lg font-bold">
        Exportar
      </h2>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <fieldset>
          <legend className="text-sm font-semibold">O que levar no arquivo</legend>
          <ul className="mt-2 space-y-1">
            {EXPORT_SECTIONS.map((s) => (
              <li key={s}>
                <label className="inline-flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen.includes(s)}
                    onChange={() => toggle(s)}
                  />
                  <span>
                    <strong>{EXPORT_SECTION_INFO[s].label}</strong> —{' '}
                    {EXPORT_SECTION_INFO[s].detail}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {needsPassword ? (
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <TextField
              label="Senha do arquivo"
              type="password"
              autoComplete="new-password"
              hint="Pelo menos 10 caracteres. Sem ela não dá para abrir as partes protegidas."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              label="Repita a senha"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </div>
        ) : (
          <p className="text-sm text-slate-700">
            Sem Usuários e Desligamento remoto o arquivo não precisa de senha. No outro PC será
            preciso criar os usuários e rodar o comando de preparo nas máquinas para desligá-las.
          </p>
        )}
        <FormError message={error} />
        {saved && (
          <p role="status" className="text-sm text-green-800">
            Arquivo {saved} salvo. Guarde-o num lugar seguro.
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Exportando…' : 'Exportar'}
        </Button>
      </form>
    </section>
  );
}

// ----------------------------------------------------------------------------- import

function ImportSection() {
  const qc = useQueryClient();
  const [file, setFile] = useState<ImportInspect | null>(null);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportPreview | null>(null);

  function reset() {
    setPreview(null);
    setTyped('');
    setError(null);
  }

  async function choose(f: File | undefined) {
    reset();
    setFile(null);
    setResult(null);
    if (!f) return;
    setBusy(true);
    try {
      setFile(await inspectFile(f));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const body = () => ({ mode, ...(file?.manifest.secrets ? { password } : {}) });

  async function seePreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewImport(file.importId, body()));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await applyImport(file.importId, body()));
      setFile(null);
      setPreview(null);
      setPassword('');
      setTyped('');
      await qc.invalidateQueries();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const m = file?.manifest;
  return (
    <section
      aria-labelledby="importar"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="importar" className="text-lg font-bold">
        Importar
      </h2>
      <label className="block text-sm font-medium">
        Arquivo .uniwake
        <input
          type="file"
          accept=".uniwake"
          className="mt-1 block text-sm"
          disabled={busy}
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </label>
      {busy && !file && <LoadingState label="Lendo o arquivo…" />}
      {result && (
        <div
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900"
        >
          <p>
            <strong>Importação concluída.</strong>
            {result.standby &&
              ' Este UniWake está em espera: ative-o em "Situação" quando estiver pronto.'}
          </p>
        </div>
      )}
      {m && file && (
        <div className="space-y-3">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <Row k="Origem" v={m.source.name} />
            <Row k="Criado em" v={formatDateTime(m.createdAt)} />
            <Row k="Versão do UniWake" v={m.appVersion} />
            <Row k="Partes" v={m.sections.map((s) => EXPORT_SECTION_INFO[s].label).join(', ')} />
            <Row k="Partes protegidas por senha" v={m.secrets ? 'sim' : 'não'} />
          </dl>
          {file.blocked ? (
            <p role="alert" className="text-sm text-red-800">
              {file.blocked}
            </p>
          ) : (
            <>
              {m.secrets && (
                <TextField
                  label="Senha do arquivo"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    reset();
                  }}
                  className="max-w-sm"
                />
              )}
              <fieldset>
                <legend className="text-sm font-semibold">Como importar</legend>
                <label className="mt-1 flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="modo"
                    className="mt-1"
                    checked={mode === 'merge'}
                    onChange={() => {
                      setMode('merge');
                      reset();
                    }}
                  />
                  <span>
                    <strong>Mesclar</strong> — junta o arquivo ao que já existe aqui; nada deste PC
                    é apagado e vale a versão mais recente de cada item.
                  </span>
                </label>
                <label className="mt-1 flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="modo"
                    className="mt-1"
                    checked={mode === 'replace'}
                    onChange={() => {
                      setMode('replace');
                      reset();
                    }}
                  />
                  <span>
                    <strong>Substituir</strong> — este PC passa a ter exatamente o cadastro e os
                    agendamentos do arquivo (para um PC novo ou para restaurar).
                  </span>
                </label>
              </fieldset>
              <Button onClick={() => void seePreview()} disabled={busy}>
                Ver prévia
              </Button>
            </>
          )}
        </div>
      )}
      {preview && <PreviewTable p={preview} />}
      {preview && (
        <div className="space-y-2">
          <TextField
            label="Digite IMPORTAR para confirmar"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="max-w-sm"
          />
          <p className="text-xs text-slate-600">
            Antes de importar, o UniWake faz um backup do banco; dá para desfazer depois.
          </p>
          <Button
            variant={mode === 'replace' ? 'danger' : 'primary'}
            disabled={typed.trim() !== 'IMPORTAR' || busy}
            onClick={() => void doImport()}
          >
            Importar
          </Button>
        </div>
      )}
      <FormError message={error} />
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1">
      <dt className="text-slate-600">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function PreviewTable({ p }: { p: ImportPreview }) {
  const sections = EXPORT_SECTIONS.filter((s) => p.sections[s]);
  return (
    <div className="space-y-2">
      <table className="min-w-full text-sm">
        <caption className="mb-1 text-left font-semibold">Prévia da importação</caption>
        <thead className="bg-slate-50 text-left">
          <tr>
            <th scope="col" className="px-2 py-1">
              Parte
            </th>
            <th scope="col" className="px-2 py-1">
              Novos
            </th>
            <th scope="col" className="px-2 py-1">
              Atualizados
            </th>
            <th scope="col" className="px-2 py-1">
              Sem mudança
            </th>
            <th scope="col" className="px-2 py-1">
              Ignorados
            </th>
            {p.mode === 'replace' && (
              <th scope="col" className="px-2 py-1">
                Removidos deste PC
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sections.map((s) => {
            const c = p.sections[s]!;
            return (
              <tr key={s}>
                <td className="px-2 py-1">{EXPORT_SECTION_INFO[s].label}</td>
                <td className="px-2 py-1">{c.created}</td>
                <td className="px-2 py-1">{c.updated}</td>
                <td className="px-2 py-1">{c.unchanged}</td>
                <td className="px-2 py-1">{c.ignored}</td>
                {p.mode === 'replace' && <td className="px-2 py-1">{p.removed[s] ?? 0}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {p.conflicts.length > 0 && (
        <div className="text-sm">
          <p className="font-semibold">Conflitos ({p.conflicts.length})</p>
          <ul className="list-disc pl-5">
            {p.conflicts.slice(0, 20).map((c, i) => (
              <li key={i}>
                {c.label}: {c.resolution}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {p.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
