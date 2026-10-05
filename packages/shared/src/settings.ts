/**
 * Settings registry (constitution §2.4, NFR-03, spec §9).
 * Each key has a Zod schema, a default and UI metadata, so the settings form can be generated and
 * a test can prove every setting is editable in the UI (AC-016-01).
 * Absent value in the DB = default. `storage: 'config'` keys live in config.json (bootstrap).
 */
import { z } from 'zod';

export const SETTINGS_GROUPS = {
  wake: 'Ligação (Wake-on-LAN)',
  monitor: 'Monitoramento',
  scheduler: 'Agendamentos',
  update: 'Atualizações',
  security: 'Segurança',
  panel: 'Acesso ao painel',
  enrollment: 'Preparar máquinas',
  retention: 'Retenção de dados',
  backup: 'Backups',
  bootstrap: 'Serviço (requer reinício)',
} as const;
export type SettingsGroup = keyof typeof SETTINGS_GROUPS;

export type SettingInput =
  'number' | 'boolean' | 'text' | 'select' | 'time' | 'timezone' | 'number-list' | 'text-list';

export interface SettingMeta {
  group: SettingsGroup;
  label: string;
  help?: string;
  input: SettingInput;
  unit?: string;
  min?: number;
  max?: number;
  options?: readonly { value: string; label: string }[];
  requiresRestart?: boolean;
  storage?: 'db' | 'config';
}

export interface SettingDef<S extends z.ZodType = z.ZodType> {
  schema: S;
  default: z.infer<S>;
  meta: SettingMeta;
}

function def<S extends z.ZodType>(
  schema: S,
  defaultValue: z.infer<S>,
  meta: SettingMeta,
): SettingDef<S> {
  return { schema, default: defaultValue, meta };
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const port = int(1, 65535);
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:mm');

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'Fuso horário inválido');
const ipv4 = z.ipv4();

export const SETTING_DEFS = {
  // Wake
  'wake.confirmThreshold': def(int(1, 5000), 40, {
    group: 'wake',
    label: 'Pedir confirmação acima de',
    help: 'Ligações com mais máquinas que isso, em mais de uma sala ou em "Todos" pedem confirmação.',
    input: 'number',
    unit: 'máquinas',
    min: 1,
    max: 5000,
  }),
  'wake.ports': def(z.array(port).min(1).max(4), [9, 7], {
    group: 'wake',
    label: 'Portas UDP do pacote mágico',
    input: 'number-list',
    min: 1,
    max: 65535,
  }),
  'wake.repeat': def(int(1, 10), 3, {
    group: 'wake',
    label: 'Repetições de cada pacote',
    input: 'number',
    min: 1,
    max: 10,
  }),
  'wake.repeatIntervalMs': def(int(0, 2000), 100, {
    group: 'wake',
    label: 'Intervalo entre repetições',
    input: 'number',
    unit: 'ms',
    min: 0,
    max: 2000,
  }),
  'wake.batchSize': def(int(1, 500), 10, {
    group: 'wake',
    label: 'Máquinas por lote (padrão)',
    help: 'Ligar aos poucos evita pico de energia. Cada sala pode ter seu próprio valor.',
    input: 'number',
    min: 1,
    max: 500,
  }),
  'wake.batchDelaySeconds': def(int(0, 600), 5, {
    group: 'wake',
    label: 'Espera entre lotes (padrão)',
    input: 'number',
    unit: 's',
    min: 0,
    max: 600,
  }),
  'wake.maxDevicesPerStep': def(int(1, 1000), 30, {
    group: 'wake',
    label: 'Máximo de máquinas por etapa (todas as salas)',
    input: 'number',
    min: 1,
    max: 1000,
  }),
  'wake.verifyIntervalSeconds': def(int(5, 300), 15, {
    group: 'wake',
    label: 'Verificar se ligou a cada',
    input: 'number',
    unit: 's',
    min: 5,
    max: 300,
  }),
  'wake.verifyWindowMinutes': def(int(1, 60), 5, {
    group: 'wake',
    label: 'Tempo máximo para considerar que não ligou',
    input: 'number',
    unit: 'min',
    min: 1,
    max: 60,
  }),
  'wake.dryRun': def(z.boolean(), false, {
    group: 'wake',
    label: 'Modo simulação (não envia pacotes)',
    input: 'boolean',
  }),
  'wake.interfaces': def(z.array(ipv4).max(16), [], {
    group: 'wake',
    label: 'Placas de rede usadas',
    help: 'Vazio = automático (placas com gateway padrão).',
    input: 'text-list',
  }),
  'wake.rateLimitPerMinute': def(int(1, 1000), 30, {
    group: 'wake',
    label: 'Limite de ligações por usuário',
    input: 'number',
    unit: 'por minuto',
    min: 1,
    max: 1000,
  }),
  // Monitor
  'monitor.intervalSeconds': def(int(10, 3600), 60, {
    group: 'monitor',
    label: 'Intervalo entre varreduras',
    input: 'number',
    unit: 's',
    min: 10,
    max: 3600,
  }),
  'monitor.concurrency': def(int(1, 512), 64, {
    group: 'monitor',
    label: 'Verificações simultâneas',
    input: 'number',
    min: 1,
    max: 512,
  }),
  'monitor.icmpTimeoutMs': def(int(100, 10000), 1000, {
    group: 'monitor',
    label: 'Tempo limite do ping',
    input: 'number',
    unit: 'ms',
    min: 100,
    max: 10000,
  }),
  'monitor.tcpTimeoutMs': def(int(100, 10000), 800, {
    group: 'monitor',
    label: 'Tempo limite da verificação TCP',
    input: 'number',
    unit: 'ms',
    min: 100,
    max: 10000,
  }),
  'monitor.tcpPorts': def(z.array(port).max(10), [135, 445, 3389], {
    group: 'monitor',
    label: 'Portas TCP verificadas',
    help: 'Usadas quando o ping é bloqueado pelo firewall do Windows.',
    input: 'number-list',
    min: 1,
    max: 65535,
  }),
  'monitor.offlineAfter': def(int(1, 10), 2, {
    group: 'monitor',
    label: 'Considerar desligada após',
    input: 'number',
    unit: 'varreduras sem resposta',
    min: 1,
    max: 10,
  }),
  'monitor.dnsCacheMinutes': def(int(0, 1440), 5, {
    group: 'monitor',
    label: 'Cache de nomes (DNS)',
    input: 'number',
    unit: 'min',
    min: 0,
    max: 1440,
  }),
  // Scheduler
  'scheduler.graceMinutes': def(int(0, 240), 15, {
    group: 'scheduler',
    label: 'Tolerância para agendamentos atrasados',
    help: 'Se o serviço estava parado no horário, a ligação ainda acontece dentro deste prazo.',
    input: 'number',
    unit: 'min',
    min: 0,
    max: 240,
  }),
  'scheduler.timezone': def(timeZoneSchema, 'America/Sao_Paulo', {
    group: 'scheduler',
    label: 'Fuso horário padrão',
    input: 'timezone',
  }),
  // Update
  'update.mode': def(z.enum(['auto', 'manual']), 'auto', {
    group: 'update',
    label: 'Atualização',
    input: 'select',
    options: [
      { value: 'auto', label: 'Automática (na janela de manutenção)' },
      { value: 'manual', label: 'Manual (só avisar)' },
    ],
  }),
  'update.windowStart': def(timeOfDaySchema, '03:00', {
    group: 'update',
    label: 'Início da janela de manutenção',
    input: 'time',
  }),
  'update.windowEnd': def(timeOfDaySchema, '05:00', {
    group: 'update',
    label: 'Fim da janela de manutenção',
    input: 'time',
  }),
  'update.checkIntervalHours': def(int(1, 168), 6, {
    group: 'update',
    label: 'Verificar atualizações a cada',
    input: 'number',
    unit: 'h',
    min: 1,
    max: 168,
  }),
  // Security
  'security.sessionIdleHours': def(int(1, 72), 12, {
    group: 'security',
    label: 'Encerrar sessão inativa após',
    input: 'number',
    unit: 'h',
    min: 1,
    max: 72,
  }),
  'security.sessionAbsoluteDays': def(int(1, 30), 7, {
    group: 'security',
    label: 'Duração máxima da sessão',
    input: 'number',
    unit: 'dias',
    min: 1,
    max: 30,
  }),
  'security.loginRatePerMinute': def(int(1, 1000), 20, {
    group: 'security',
    label: 'Tentativas de login por IP',
    input: 'number',
    unit: 'por minuto',
    min: 1,
    max: 1000,
  }),
  // Panel
  'panel.lanEnabled': def(z.boolean(), false, {
    group: 'panel',
    label: 'Permitir acesso ao painel pela rede (HTTPS)',
    help: 'Desligado = o painel só abre neste computador.',
    input: 'boolean',
    requiresRestart: true,
  }),
  'panel.lanAddress': def(z.union([z.literal(''), ipv4]), '', {
    group: 'panel',
    label: 'Endereço de rede do painel',
    help: 'Endereço IPv4 deste computador na rede da faculdade (ex.: 10.0.3.5).',
    input: 'text',
    requiresRestart: true,
  }),
  // Enrollment
  'enrollment.tokenExpiryHours': def(int(1, 168), 8, {
    group: 'enrollment',
    label: 'Validade do código de cadastro',
    input: 'number',
    unit: 'h',
    min: 1,
    max: 168,
  }),
  'enrollment.tokenMaxUses': def(int(1, 10000), 100, {
    group: 'enrollment',
    label: 'Usos por código de cadastro',
    input: 'number',
    min: 1,
    max: 10000,
  }),
  'enrollment.hubAddress': def(z.union([z.literal(''), ipv4]), '', {
    group: 'enrollment',
    label: 'Endereço usado pelas máquinas para se cadastrar',
    help: 'Vazio = placa com gateway padrão.',
    input: 'text',
  }),
  // Retention
  'retention.historyDays': def(int(7, 3650), 180, {
    group: 'retention',
    label: 'Histórico de status',
    input: 'number',
    unit: 'dias',
    min: 7,
    max: 3650,
  }),
  'retention.packetLogDays': def(int(1, 365), 30, {
    group: 'retention',
    label: 'Registro de pacotes',
    input: 'number',
    unit: 'dias',
    min: 1,
    max: 365,
  }),
  'retention.auditDays': def(int(30, 3650), 365, {
    group: 'retention',
    label: 'Auditoria',
    input: 'number',
    unit: 'dias',
    min: 30,
    max: 3650,
  }),
  // Backup
  'backup.time': def(timeOfDaySchema, '02:30', {
    group: 'backup',
    label: 'Horário do backup diário',
    input: 'time',
  }),
  'backup.retention': def(int(1, 365), 14, {
    group: 'backup',
    label: 'Backups diários mantidos',
    input: 'number',
    min: 1,
    max: 365,
  }),
  // Bootstrap (config.json)
  'bootstrap.panelPort': def(port, 47100, {
    group: 'bootstrap',
    label: 'Porta do painel',
    input: 'number',
    min: 1,
    max: 65535,
    requiresRestart: true,
    storage: 'config',
  }),
  'bootstrap.agentPort': def(port, 47101, {
    group: 'bootstrap',
    label: 'Porta de cadastro das máquinas',
    input: 'number',
    min: 1,
    max: 65535,
    requiresRestart: true,
    storage: 'config',
  }),
  'bootstrap.logLevel': def(z.enum(['debug', 'info', 'warn', 'error']), 'info', {
    group: 'bootstrap',
    label: 'Nível de log',
    input: 'select',
    options: [
      { value: 'debug', label: 'Depuração' },
      { value: 'info', label: 'Normal' },
      { value: 'warn', label: 'Avisos' },
      { value: 'error', label: 'Só erros' },
    ],
    requiresRestart: true,
    storage: 'config',
  }),
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTING_DEFS)[K]['schema']> };
export const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

export const DEFAULT_SETTINGS = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, SETTING_DEFS[k].default]),
) as Settings;

/** Partial update accepted by `PATCH /api/settings`; unknown keys are rejected. */
export const settingsPatchSchema = z
  .object(
    Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTING_DEFS[k].schema.optional()])) as {
      [K in SettingKey]: z.ZodOptional<(typeof SETTING_DEFS)[K]['schema']>;
    },
  )
  .strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFS, key);
}
