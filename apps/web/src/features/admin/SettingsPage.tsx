import { type FormEvent, useState } from 'react';
import {
  SETTING_DEFS,
  SETTING_KEYS,
  type SettingKey,
  type Settings,
  SETTINGS_GROUPS,
  type SettingsGroup,
} from '@uniwake/shared';
import { ApiRequestError } from '../../api/client';
import { BackupsSection } from './BackupsSection';
import { Banner, ErrorState, LoadingState } from '../../components/Banner';
import { FormError, TextField } from '../../components/form';
import { Button, PageHeader, SelectField } from '../../components/ui';
import { TIMEZONES } from '../schedules/format';
import {
  type SettingsView,
  useNetworkPreview,
  useSaveSettings,
  useSettings,
  useUploadCertificate,
} from './api';

/** Text shown in an input for a stored value (lists as "9, 7"). */
export function toInput(key: SettingKey, v: unknown): string | boolean {
  const input = SETTING_DEFS[key].meta.input;
  if (input === 'boolean') return Boolean(v);
  if (Array.isArray(v)) return v.join(', ');
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/** The value to send for an input's text (numbers parsed, lists split). */
export function fromInput(key: SettingKey, v: string | boolean): unknown {
  const input = SETTING_DEFS[key].meta.input;
  if (input === 'boolean') return v === true;
  const s = String(v).trim();
  if (input === 'number') return s === '' ? NaN : Number(s);
  if (input === 'number-list')
    return s === ''
      ? []
      : s
          .split(/[,;\s]+/)
          .filter(Boolean)
          .map(Number);
  if (input === 'text-list')
    return s === ''
      ? []
      : s
          .split(/[,;]+/)
          .map((x) => x.trim())
          .filter(Boolean);
  return s;
}

const groupKeys = (g: SettingsGroup) =>
  SETTING_KEYS.filter((k) => SETTING_DEFS[k].meta.group === g);

/** Configurações (FR-016): a form generated from the shared settings registry (admin). */
export function SettingsPage() {
  const settings = useSettings();
  if (settings.isPending) return <LoadingState />;
  if (settings.isError) {
    return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;
  }
  return <SettingsForm view={settings.data} />;
}

function SettingsForm({ view }: { view: SettingsView }) {
  return (
    <section className="space-y-6">
      <PageHeader title="Configurações" />
      {view.pendingRestart.length > 0 && (
        <Banner tone="warning">
          Alterações salvas que só valem depois de reiniciar o serviço UniWake:{' '}
          {view.pendingRestart.map((k) => SETTING_DEFS[k].meta.label).join(', ')}.
        </Banner>
      )}
      {(Object.keys(SETTINGS_GROUPS) as SettingsGroup[]).map((g) => (
        <GroupForm key={g} group={g} values={view.values} />
      ))}
      <NetworkPreviewSection />
      <CertificateSection />
      <BackupsSection />
    </section>
  );
}

function GroupForm({ group, values }: { group: SettingsGroup; values: Settings }) {
  const save = useSaveSettings();
  const keys = groupKeys(group);
  const initial = Object.fromEntries(keys.map((k) => [k, toInput(k, values[k])])) as Record<
    SettingKey,
    string | boolean
  >;
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const changed = keys.filter((k) => draft[k] !== initial[k]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    setFormError(null);
    try {
      const r = await save.mutateAsync(
        Object.fromEntries(changed.map((k) => [k, fromInput(k, draft[k])])),
      );
      setMessage(
        r.restartRequired.length > 0
          ? 'Salvo. Algumas alterações só valem depois de reiniciar o serviço.'
          : 'Salvo. As alterações já estão valendo.',
      );
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.code === 'VALIDATION_FAILED' &&
        Array.isArray(err.details)
      ) {
        const next: Partial<Record<SettingKey, string>> = {};
        for (const d of err.details as { path?: string; message?: string }[]) {
          const key = (d.path ?? '').split('.').slice(0, 2).join('.') as SettingKey;
          if (keys.includes(key)) next[key] ??= d.message ?? 'Valor inválido.';
        }
        if (Object.keys(next).length > 0) return setErrors(next);
      }
      setFormError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby={`grupo-${group}`}
      className="rounded-lg border border-slate-200 bg-white p-4"
      noValidate
    >
      <h2 id={`grupo-${group}`} className="mb-3 text-lg font-bold">
        {SETTINGS_GROUPS[group]}
      </h2>
      <FormError message={formError} />
      <div className="grid gap-4 md:grid-cols-2">
        {keys.map((k) => (
          <SettingControl
            key={k}
            settingKey={k}
            value={draft[k]}
            error={errors[k]}
            onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={changed.length === 0 || save.isPending}>
          Salvar {SETTINGS_GROUPS[group].toLowerCase()}
        </Button>
        {message && (
          <p role="status" className="text-sm text-green-800">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}

function SettingControl({
  settingKey,
  value,
  error,
  onChange,
}: {
  settingKey: SettingKey;
  value: string | boolean;
  error?: string | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const { meta } = SETTING_DEFS[settingKey];
  const hint = [meta.help, meta.requiresRestart ? 'Requer reiniciar o serviço.' : null]
    .filter(Boolean)
    .join(' ');
  if (meta.input === 'boolean') {
    return (
      <div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {meta.label}
        </label>
        {hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
        {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      </div>
    );
  }
  if (meta.input === 'select' || meta.input === 'timezone') {
    const options =
      meta.input === 'select'
        ? (meta.options ?? [])
        : [...new Set([String(value), ...TIMEZONES])].map((z) => ({ value: z, label: z }));
    return (
      <div>
        <SelectField
          label={meta.label}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        {hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
        {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      </div>
    );
  }
  const type = meta.input === 'number' ? 'number' : meta.input === 'time' ? 'time' : 'text';
  const listHint = meta.input.endsWith('-list') ? 'Separe os valores por vírgula.' : null;
  return (
    <TextField
      label={meta.unit ? `${meta.label} (${meta.unit})` : meta.label}
      type={type}
      value={String(value)}
      min={meta.min}
      max={meta.max}
      onChange={(e) => onChange(e.target.value)}
      hint={[hint, listHint].filter(Boolean).join(' ') || undefined}
      error={error}
    />
  );
}

function NetworkPreviewSection() {
  const preview = useNetworkPreview();
  return (
    <section aria-labelledby="rede" className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 id="rede" className="mb-1 text-lg font-bold">
        Rede usada para ligar as máquinas
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        Placas de rede deste computador e os destinos exatos de cada pacote de Wake-on-LAN.
      </p>
      {preview.isPending ? (
        <LoadingState />
      ) : preview.isError ? (
        <ErrorState message={preview.error.message} onRetry={() => void preview.refetch()} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Placas de rede</caption>
              <thead className="text-left">
                <tr>
                  <th scope="col" className="py-1 pr-4">
                    Placa
                  </th>
                  <th scope="col" className="py-1 pr-4">
                    Endereço
                  </th>
                  <th scope="col" className="py-1 pr-4">
                    Gateway
                  </th>
                  <th scope="col" className="py-1">
                    Usada?
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.data.interfaces.map((i) => (
                  <tr key={`${i.name}-${i.address}`} className="border-t border-slate-100">
                    <td className="py-1 pr-4">{i.name}</td>
                    <td className="py-1 pr-4 font-mono">
                      {i.address}/{i.prefixLength}
                    </td>
                    <td className="py-1 pr-4 font-mono">{i.gateway ?? '—'}</td>
                    <td className="py-1">{i.selected ? 'Sim' : `Não — ${i.reason ?? ''}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="mt-3 font-semibold">Destinos</h3>
          {preview.data.destinations.length === 0 ? (
            <p className="text-sm font-semibold text-red-800">
              Nenhuma placa de rede utilizável: as ligações vão falhar.
            </p>
          ) : (
            <ul className="text-sm" aria-label="Destinos">
              {preview.data.destinations.map((d) => (
                <li key={`${d.sourceIp}>${d.destination}`} className="font-mono">
                  {d.sourceIp} → {d.destination} (portas {preview.data.ports.join(', ')},{' '}
                  {preview.data.repeat}×)
                </li>
              ))}
            </ul>
          )}
          {preview.data.rooms.map((r) => (
            <p key={r.roomId} className="mt-1 text-sm">
              {r.name}: também{' '}
              {r.destinations.map((d) => `${d.sourceIp} → ${d.destination}`).join(', ')}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

function CertificateSection() {
  const upload = useUploadCertificate();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!file) return setError('Escolha um arquivo .pfx.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    try {
      await upload.mutateAsync({ pfxBase64: btoa(binary), password });
      setMessage('Certificado salvo. Reinicie o serviço UniWake para usá-lo.');
    } catch (err) {
      if (err instanceof ApiRequestError && Array.isArray(err.details)) {
        return setError((err.details as { message?: string }[])[0]?.message ?? err.message);
      }
      setError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby="certificado"
      className="rounded-lg border border-slate-200 bg-white p-4"
      noValidate
    >
      <h2 id="certificado" className="mb-1 text-lg font-bold">
        Certificado do acesso pela rede (HTTPS)
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        Opcional. Sem ele, o UniWake gera um certificado próprio (o navegador mostra um aviso até a
        TI confiar nele).
      </p>
      <FormError message={error} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="Arquivo PFX"
          type="file"
          accept=".pfx,.p12"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <TextField
          label="Senha do PFX"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={upload.isPending}>
          Enviar certificado
        </Button>
        {message && (
          <p role="status" className="text-sm text-green-800">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
