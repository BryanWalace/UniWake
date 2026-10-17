/**
 * Settings registry (constitution §2.4, NFR-03, spec §9).
 * Each key has a Zod schema, a default and UI metadata, so the settings form can be generated and
 * a test can prove every setting is editable in the UI (AC-016-01).
 * Absent value in the DB = default. `storage: 'config'` keys live in config.json (bootstrap).
 */
import { z } from 'zod';
import {
  DEFAULT_POSTPONE_MESSAGE,
  DEFAULT_WARNING_MESSAGE,
  POSTPONE_MAX_LIMIT,
  POSTPONE_MINUTES_MAX,
  POSTPONE_MINUTES_MIN,
  WARNING_MINUTES_MAX,
} from './agent/constants';
import { POSTPONE_COUNT_PLACEHOLDER, WARNING_TIME_PLACEHOLDER } from './agent/messages';

export const SETTINGS_GROUPS = {
  wake: 'Ligação (Wake-on-LAN)',
  monitor: 'Monitoramento',
  scheduler: 'Agendamentos',
  power: 'Desligar computadores',
  update: 'Atualizações',
  security: 'Segurança',
  panel: 'Acesso ao painel',
  enrollment: 'Preparar máquinas',
  retention: 'Retenção de dados',
  backup: 'Backups',
  export: 'Exportação automática',
  bootstrap: 'Serviço (requer reinício)',
} as const;
export type SettingsGroup = keyof typeof SETTINGS_GROUPS;

export type SettingInput =
  'number' | 'boolean' | 'text' | 'select' | 'time' | 'timezone' | 'number-list' | 'text-list';

/**
 * ADR-032: `machine` settings belong to this PC (interfaces, addresses, ports, update and backup
 * schedule) and live in `machine_settings`, never synced or exported; `shared` ones are team policy.
 */
export type SettingScope = 'shared' | 'machine';

export interface SettingMeta {
  group: SettingsGroup;
  scope: SettingScope;
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

/** A local folder (`D:\pasta`) or a network share (`\\servidor\pasta`), or empty (FR-405). */
export const exportFolderSchema = z.union([
  z.literal(''),
  z
    .string()
    .trim()
    .max(240)
    .regex(
      // Windows folder or share; an absolute POSIX path only matters for development and CI.
      /^(([A-Za-z]:\\|\\\\[^\\/:*?"<>|\s]+\\[^\\/:*?"<>|]+)[^:*?"<>|]*|\/[^:*?"<>|]*)$/,
      'Use uma pasta como D:\\Exportacoes ou \\\\servidor\\pasta.',
    )
    .refine((p) => [...p].every((c) => c.charCodeAt(0) >= 32), 'Caractere inválido na pasta.'),
]);

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
    scope: 'shared',
    label: 'Pedir confirmação acima de',
    help: 'Ligações com mais máquinas que isso, em mais de uma sala ou em "Todos" pedem confirmação.',
    input: 'number',
    unit: 'máquinas',
    min: 1,
    max: 5000,
  }),
  'wake.ports': def(z.array(port).min(1).max(4), [9, 7], {
    group: 'wake',
    scope: 'shared',
    label: 'Portas UDP do pacote mágico',
    input: 'number-list',
    min: 1,
    max: 65535,
  }),
  'wake.repeat': def(int(1, 10), 3, {
    group: 'wake',
    scope: 'shared',
    label: 'Repetições de cada pacote',
    input: 'number',
    min: 1,
    max: 10,
  }),
  'wake.repeatIntervalMs': def(int(0, 2000), 100, {
    group: 'wake',
    scope: 'shared',
    label: 'Intervalo entre repetições',
    input: 'number',
    unit: 'ms',
    min: 0,
    max: 2000,
  }),
  'wake.batchSize': def(int(1, 500), 10, {
    group: 'wake',
    scope: 'shared',
    label: 'Máquinas por lote (padrão)',
    help: 'Ligar aos poucos evita pico de energia. Cada sala pode ter seu próprio valor.',
    input: 'number',
    min: 1,
    max: 500,
  }),
  'wake.batchDelaySeconds': def(int(0, 600), 5, {
    group: 'wake',
    scope: 'shared',
    label: 'Espera entre lotes (padrão)',
    input: 'number',
    unit: 's',
    min: 0,
    max: 600,
  }),
  'wake.maxDevicesPerStep': def(int(1, 1000), 30, {
    group: 'wake',
    scope: 'shared',
    label: 'Máximo de máquinas por etapa (todas as salas)',
    input: 'number',
    min: 1,
    max: 1000,
  }),
  'wake.verifyIntervalSeconds': def(int(5, 300), 15, {
    group: 'wake',
    scope: 'shared',
    label: 'Verificar se ligou a cada',
    input: 'number',
    unit: 's',
    min: 5,
    max: 300,
  }),
  'wake.verifyWindowMinutes': def(int(1, 60), 5, {
    group: 'wake',
    scope: 'shared',
    label: 'Tempo máximo para considerar que não ligou',
    input: 'number',
    unit: 'min',
    min: 1,
    max: 60,
  }),
  'wake.dryRun': def(z.boolean(), false, {
    group: 'wake',
    scope: 'machine',
    label: 'Modo simulação (não envia pacotes)',
    input: 'boolean',
  }),
  'wake.interfaces': def(z.array(ipv4).max(16), [], {
    group: 'wake',
    scope: 'machine',
    label: 'Placas de rede usadas',
    help: 'Vazio = automático (placas com gateway padrão).',
    input: 'text-list',
  }),
  'wake.rateLimitPerMinute': def(int(1, 1000), 30, {
    group: 'wake',
    scope: 'shared',
    label: 'Limite de ligações por usuário',
    input: 'number',
    unit: 'por minuto',
    min: 1,
    max: 1000,
  }),
  // Monitor
  'monitor.intervalSeconds': def(int(10, 3600), 60, {
    group: 'monitor',
    scope: 'shared',
    label: 'Intervalo entre varreduras',
    input: 'number',
    unit: 's',
    min: 10,
    max: 3600,
  }),
  'monitor.concurrency': def(int(1, 512), 64, {
    group: 'monitor',
    scope: 'shared',
    label: 'Verificações simultâneas',
    input: 'number',
    min: 1,
    max: 512,
  }),
  'monitor.icmpTimeoutMs': def(int(100, 10000), 1000, {
    group: 'monitor',
    scope: 'shared',
    label: 'Tempo limite do ping',
    input: 'number',
    unit: 'ms',
    min: 100,
    max: 10000,
  }),
  'monitor.tcpTimeoutMs': def(int(100, 10000), 800, {
    group: 'monitor',
    scope: 'shared',
    label: 'Tempo limite da verificação TCP',
    input: 'number',
    unit: 'ms',
    min: 100,
    max: 10000,
  }),
  'monitor.tcpPorts': def(z.array(port).max(10), [135, 445, 3389], {
    group: 'monitor',
    scope: 'shared',
    label: 'Portas TCP verificadas',
    help: 'Usadas quando o ping é bloqueado pelo firewall do Windows.',
    input: 'number-list',
    min: 1,
    max: 65535,
  }),
  'monitor.offlineAfter': def(int(1, 10), 2, {
    group: 'monitor',
    scope: 'shared',
    label: 'Considerar desligada após',
    input: 'number',
    unit: 'varreduras sem resposta',
    min: 1,
    max: 10,
  }),
  'monitor.dnsCacheMinutes': def(int(0, 1440), 5, {
    group: 'monitor',
    scope: 'shared',
    label: 'Cache de nomes (DNS)',
    input: 'number',
    unit: 'min',
    min: 0,
    max: 1440,
  }),
  // Scheduler
  'scheduler.graceMinutes': def(int(0, 240), 15, {
    group: 'scheduler',
    scope: 'shared',
    label: 'Tolerância para agendamentos atrasados',
    help: 'Se o serviço estava parado no horário, a ligação ainda acontece dentro deste prazo.',
    input: 'number',
    unit: 'min',
    min: 0,
    max: 240,
  }),
  'scheduler.timezone': def(timeZoneSchema, 'America/Sao_Paulo', {
    group: 'scheduler',
    scope: 'shared',
    label: 'Fuso horário padrão',
    input: 'timezone',
  }),
  // Update
  'update.mode': def(z.enum(['auto', 'manual']), 'auto', {
    group: 'update',
    scope: 'machine',
    label: 'Atualização',
    input: 'select',
    options: [
      { value: 'auto', label: 'Automática (na janela de manutenção)' },
      { value: 'manual', label: 'Manual (só avisar)' },
    ],
  }),
  'update.windowStart': def(timeOfDaySchema, '03:00', {
    group: 'update',
    scope: 'machine',
    label: 'Início da janela de manutenção',
    input: 'time',
  }),
  'update.windowEnd': def(timeOfDaySchema, '05:00', {
    group: 'update',
    scope: 'machine',
    label: 'Fim da janela de manutenção',
    input: 'time',
  }),
  'update.checkIntervalHours': def(int(1, 168), 6, {
    group: 'update',
    scope: 'machine',
    label: 'Verificar atualizações a cada',
    input: 'number',
    unit: 'h',
    min: 1,
    max: 168,
  }),
  // Security
  'security.sessionIdleHours': def(int(1, 72), 12, {
    group: 'security',
    scope: 'shared',
    label: 'Encerrar sessão inativa após',
    input: 'number',
    unit: 'h',
    min: 1,
    max: 72,
  }),
  'security.sessionAbsoluteDays': def(int(1, 30), 7, {
    group: 'security',
    scope: 'shared',
    label: 'Duração máxima da sessão',
    input: 'number',
    unit: 'dias',
    min: 1,
    max: 30,
  }),
  'security.loginRatePerMinute': def(int(1, 1000), 20, {
    group: 'security',
    scope: 'shared',
    label: 'Tentativas de login por IP',
    input: 'number',
    unit: 'por minuto',
    min: 1,
    max: 1000,
  }),
  // Panel
  'panel.lanEnabled': def(z.boolean(), false, {
    group: 'panel',
    scope: 'machine',
    label: 'Permitir acesso ao painel pela rede (HTTPS)',
    help: 'Desligado = o painel só abre neste computador.',
    input: 'boolean',
    requiresRestart: true,
  }),
  'panel.lanAddress': def(z.union([z.literal(''), ipv4]), '', {
    group: 'panel',
    scope: 'machine',
    label: 'Endereço de rede do painel',
    help: 'Endereço IPv4 deste computador na rede da faculdade (ex.: 10.0.3.5).',
    input: 'text',
    requiresRestart: true,
  }),
  // Power (v1.3, FR-304): defaults of new shutdown schedules and of the manual "5 min com
  // adiamento" option, and the warning texts.
  'power.defaultWarningMinutes': def(int(0, WARNING_MINUTES_MAX), 5, {
    group: 'power',
    scope: 'shared',
    label: 'Aviso antes de desligar (padrão)',
    help: 'Usado em novos agendamentos de desligar e na opção "5 min com adiamento" do Desligar manual.',
    input: 'number',
    unit: 'min',
    min: 0,
    max: WARNING_MINUTES_MAX,
  }),
  'power.postponeMax': def(int(0, POSTPONE_MAX_LIMIT), 2, {
    group: 'power',
    scope: 'shared',
    label: 'Quantas vezes o usuário pode adiar (padrão)',
    input: 'number',
    min: 0,
    max: POSTPONE_MAX_LIMIT,
  }),
  'power.postponeMinutes': def(int(POSTPONE_MINUTES_MIN, POSTPONE_MINUTES_MAX), 15, {
    group: 'power',
    scope: 'shared',
    label: 'Duração de cada adiamento (padrão)',
    input: 'number',
    unit: 'min',
    min: POSTPONE_MINUTES_MIN,
    max: POSTPONE_MINUTES_MAX,
  }),
  'power.warningMessage': def(
    z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine((s) => s.includes(WARNING_TIME_PLACEHOLDER), 'Mantenha {hora} no texto do aviso'),
    DEFAULT_WARNING_MESSAGE,
    {
      group: 'power',
      scope: 'shared',
      label: 'Texto do aviso',
      help: '{hora} é trocado pelo horário do desligamento. Diga que o que não for salvo será perdido.',
      input: 'text',
    },
  ),
  'power.postponeMessage': def(
    z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine((s) => s.includes(POSTPONE_COUNT_PLACEHOLDER), 'Mantenha {n} no texto'),
    DEFAULT_POSTPONE_MESSAGE,
    {
      group: 'power',
      scope: 'shared',
      label: 'Texto quando ainda dá para adiar',
      help: 'Acrescentado ao aviso; {n} é trocado pelo número de adiamentos restantes.',
      input: 'text',
    },
  ),
  // v1.6.0 (FR-605.2, ADR-061): sleeping and hibernated machines.
  'power.wakeForShutdown': def(z.boolean(), true, {
    group: 'power',
    scope: 'shared',
    label: 'Acordar máquinas suspensas ou hibernadas para desligar',
    help: 'Quando um desligamento é enviado, as máquinas prontas que não respondem e consultaram o UniWake nas últimas 12 horas recebem o pacote de ligar e desligam ao acordar. Uma máquina que estava desligada de verdade liga, recebe a ordem e desliga de novo.',
    input: 'boolean',
  }),
  // Enrollment
  'enrollment.tokenExpiryHours': def(int(1, 168), 8, {
    group: 'enrollment',
    scope: 'shared',
    label: 'Validade do código de cadastro',
    input: 'number',
    unit: 'h',
    min: 1,
    max: 168,
  }),
  'enrollment.tokenMaxUses': def(int(1, 10000), 100, {
    group: 'enrollment',
    scope: 'shared',
    label: 'Usos por código de cadastro',
    input: 'number',
    min: 1,
    max: 10000,
  }),
  'enrollment.hubAddress': def(z.union([z.literal(''), ipv4]), '', {
    group: 'enrollment',
    scope: 'machine',
    label: 'Endereço usado pelas máquinas para se cadastrar',
    help: 'Vazio = placa com gateway padrão.',
    input: 'text',
  }),
  // Retention
  'retention.historyDays': def(int(7, 3650), 180, {
    group: 'retention',
    scope: 'shared',
    label: 'Histórico de status',
    input: 'number',
    unit: 'dias',
    min: 7,
    max: 3650,
  }),
  'retention.packetLogDays': def(int(1, 365), 30, {
    group: 'retention',
    scope: 'shared',
    label: 'Registro de pacotes',
    input: 'number',
    unit: 'dias',
    min: 1,
    max: 365,
  }),
  'retention.auditDays': def(int(30, 3650), 365, {
    group: 'retention',
    scope: 'shared',
    label: 'Auditoria',
    input: 'number',
    unit: 'dias',
    min: 30,
    max: 3650,
  }),
  // Backup
  'backup.time': def(timeOfDaySchema, '02:30', {
    group: 'backup',
    scope: 'machine',
    label: 'Horário do backup diário',
    input: 'time',
  }),
  'backup.retention': def(int(1, 365), 14, {
    group: 'backup',
    scope: 'machine',
    label: 'Backups diários mantidos',
    input: 'number',
    min: 1,
    max: 365,
  }),
  // Automatic exports (v1.4, FR-405, ADR-052): this PC only; files never carry secrets.
  'export.autoEnabled': def(z.boolean(), false, {
    group: 'export',
    scope: 'machine',
    label: 'Exportar automaticamente todo dia',
    help: 'Gera um arquivo .uniwake sem Usuários e sem Desligamento remoto.',
    input: 'boolean',
  }),
  'export.autoFolder': def(exportFolderSchema, '', {
    group: 'export',
    scope: 'machine',
    label: 'Pasta das exportações',
    help: 'Ex.: D:\\UniWake-exportacoes ou \\\\servidor\\pasta. Numa pasta da rede, a conta do computador precisa poder gravar.',
    input: 'text',
  }),
  'export.autoTime': def(timeOfDaySchema, '02:45', {
    group: 'export',
    scope: 'machine',
    label: 'Horário da exportação',
    input: 'time',
  }),
  'export.autoKeep': def(int(1, 365), 14, {
    group: 'export',
    scope: 'machine',
    label: 'Exportações mantidas na pasta',
    input: 'number',
    min: 1,
    max: 365,
  }),
  // Bootstrap (config.json)
  'bootstrap.panelPort': def(port, 47100, {
    group: 'bootstrap',
    scope: 'machine',
    label: 'Porta do painel',
    input: 'number',
    min: 1,
    max: 65535,
    requiresRestart: true,
    storage: 'config',
  }),
  'bootstrap.agentPort': def(port, 47101, {
    group: 'bootstrap',
    scope: 'machine',
    label: 'Porta de cadastro das máquinas',
    input: 'number',
    min: 1,
    max: 65535,
    requiresRestart: true,
    storage: 'config',
  }),
  'bootstrap.syncPort': def(port, 47102, {
    group: 'bootstrap',
    scope: 'machine',
    label: 'Porta do Modo equipe',
    help: 'TCP e UDP. Precisa ser a mesma em todos os PCs da equipe (FR-202).',
    input: 'number',
    min: 1,
    max: 65535,
    requiresRestart: true,
    storage: 'config',
  }),
  'bootstrap.logLevel': def(z.enum(['debug', 'info', 'warn', 'error']), 'info', {
    group: 'bootstrap',
    scope: 'machine',
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
