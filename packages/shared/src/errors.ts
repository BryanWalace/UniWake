/**
 * Error codes, HTTP status and pt-BR messages (ADR-006, plan §6.6).
 * Messages say what happened and what to do next (constitution §8). `{name}` placeholders are
 * filled by `formatErrorMessage` from the error's params.
 */

export const HELP_TOPICS = [
  'fast-startup',
  'bios-erp',
  'nic-power',
  'firewall-icmp',
  'vlan-broadcast',
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

interface ErrorDef {
  status: number;
  message: string;
  help?: HelpTopic;
}

export const ERROR_DEFS = {
  VALIDATION_FAILED: { status: 422, message: 'Dados inválidos. Verifique os campos destacados.' },
  UNAUTHENTICATED: {
    status: 401,
    message: 'Sua sessão expirou ou você não entrou. Faça login novamente.',
  },
  FORBIDDEN: {
    status: 403,
    message: 'Seu perfil não tem permissão para esta ação. Peça a um administrador.',
  },
  NOT_FOUND: {
    status: 404,
    message: 'Item não encontrado. Ele pode ter sido removido; atualize a página.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Muitas solicitações em pouco tempo. Aguarde um minuto e tente novamente.',
  },
  HOST_NOT_ALLOWED: {
    status: 421,
    message: 'Endereço de acesso não permitido. Use o endereço configurado do painel.',
  },
  ORIGIN_NOT_ALLOWED: {
    status: 403,
    message: 'Requisição de origem não permitida. Recarregue o painel e tente novamente.',
  },
  SETUP_NOT_ALLOWED: {
    status: 403,
    message: 'O primeiro acesso só pode ser feito no próprio computador do UniWake (localhost).',
  },
  SETUP_ALREADY_DONE: { status: 409, message: 'O administrador já foi criado. Faça login.' },
  LOGIN_INVALID: { status: 401, message: 'Usuário ou senha incorretos.' },
  LOGIN_THROTTLED: {
    status: 429,
    message: 'Muitas tentativas de login. Aguarde {seconds} segundos e tente novamente.',
  },
  PASSWORD_TOO_WEAK: {
    status: 422,
    message: 'Senha fraca: use pelo menos 10 caracteres e evite senhas comuns.',
  },
  USER_DISABLED: {
    status: 403,
    message: 'Este usuário está desativado. Fale com um administrador.',
  },
  LAST_ADMIN: {
    status: 409,
    message:
      'Este é o último administrador ativo. Promova outro usuário a administrador antes de alterá-lo.',
  },
  USERNAME_DUPLICATE: {
    status: 409,
    message: 'Já existe um usuário com este nome. Escolha outro.',
  },
  DEVICE_MAC_DUPLICATE: {
    status: 409,
    message: 'O MAC {mac} já está cadastrado no dispositivo "{deviceName}".',
  },
  DEVICE_NOT_FOUND: {
    status: 422,
    message: 'Dispositivo(s) não encontrado(s): {ids}. Atualize a página e tente novamente.',
  },
  MAC_INVALID: {
    status: 422,
    message:
      'Endereço MAC inválido. Use o formato AA:BB:CC:DD:EE:FF (endereço da placa de rede cabeada).',
  },
  IP_INVALID: { status: 422, message: 'Endereço IP inválido. Use o formato 10.0.0.15.' },
  ROOM_NAME_DUPLICATE: { status: 409, message: 'Já existe uma sala com este nome.' },
  ROOM_CODE_DUPLICATE: {
    status: 409,
    message: 'O código de sala {code} já está em uso. Escolha outro.',
  },
  TAG_NAME_DUPLICATE: { status: 409, message: 'Já existe uma etiqueta com este nome.' },
  CSV_INVALID: {
    status: 422,
    message: 'Não foi possível ler o arquivo CSV: {reason}. Confira o modelo e tente de novo.',
  },
  CSV_TOO_LARGE: {
    status: 413,
    message: 'Arquivo CSV muito grande (máximo 2 MB e 5000 linhas). Divida em partes.',
  },
  CONFIRMATION_REQUIRED: {
    status: 409,
    message: 'Confirme a ação: {count} máquinas serão ligadas.',
  },
  DELETE_CONFIRMATION_REQUIRED: {
    status: 409,
    message:
      'Confirme a exclusão: {devices} dispositivo(s) irão para "Sem sala" e {schedules} agendamento(s) usam este item.',
  },
  WAKE_ALREADY_RUNNING: {
    status: 409,
    message: 'Já existe uma ligação em andamento para estas máquinas. Acompanhe o andamento.',
  },
  WAKE_TARGET_EMPTY: {
    status: 422,
    message:
      'Nenhuma máquina corresponde ao alvo escolhido. Verifique a sala, etiqueta ou seleção.',
  },
  TARGET_NOT_FOUND: {
    status: 422,
    message:
      'Alguma sala, etiqueta ou máquina escolhida não existe mais. Atualize a página e escolha de novo.',
  },
  NO_NETWORK_INTERFACE: {
    status: 503,
    message:
      'Nenhuma placa de rede disponível no computador do UniWake. Verifique o cabo e a conexão de rede.',
    help: 'vlan-broadcast',
  },
  PAUSE_REASON_REQUIRED: {
    status: 422,
    message: 'Informe o motivo da pausa (ex.: "Férias de julho").',
  },
  ENROLL_TOKEN_INVALID: {
    status: 401,
    message: 'Código de cadastro inválido. Gere um novo em "Preparar máquinas".',
  },
  ENROLL_TOKEN_EXPIRED: {
    status: 401,
    message: 'Código de cadastro expirado. Gere um novo em "Preparar máquinas".',
  },
  ENROLL_TOKEN_REVOKED: {
    status: 401,
    message: 'Código de cadastro revogado. Gere um novo em "Preparar máquinas".',
  },
  ENROLL_TOKEN_EXHAUSTED: {
    status: 401,
    message: 'Código de cadastro atingiu o limite de usos. Gere um novo em "Preparar máquinas".',
  },
  ENROLL_ROOM_MISMATCH: {
    status: 422,
    message:
      'O código da sala não corresponde ao código de cadastro. Confira o comando copiado do painel.',
  },
  UPDATE_NOT_AVAILABLE: { status: 409, message: 'Nenhuma atualização disponível.' },
  UPDATE_IN_PROGRESS: { status: 409, message: 'Uma atualização já está em andamento.' },
  UPDATE_BLOCKED_BY_SCHEDULE: {
    status: 409,
    message: 'Atualização adiada: há ligação em andamento ou agendada para a próxima hora.',
  },
  UPDATE_DISK_SPACE: {
    status: 507,
    message: 'Espaço em disco insuficiente para atualizar. Libere pelo menos {requiredMb} MB.',
  },
  CHECKSUM_MISMATCH: {
    status: 502,
    message:
      'O arquivo de atualização baixado está corrompido ou foi alterado. Nada foi instalado.',
  },
  DOWNLOAD_FAILED: {
    status: 502,
    message: 'Falha ao baixar a atualização. Verifique a internet; uma nova tentativa será feita.',
  },
  BACKUP_NOT_FOUND: { status: 404, message: 'Backup não encontrado.' },
  RESTORE_CONFIRMATION_MISMATCH: {
    status: 422,
    message: 'Confirmação incorreta: digite a data do backup exatamente como mostrada.',
  },
  INTERNAL_ERROR: {
    status: 500,
    message:
      'Erro interno inesperado. Tente novamente; se continuar, veja os logs em Saúde do sistema.',
  },
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ERROR_DEFS;
export const ERROR_CODES = Object.keys(ERROR_DEFS) as ErrorCode[];

/** Shape of every API error response (ADR-006). */
export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type ErrorParams = Record<string, string | number>;

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_DEFS[code].status;
}

export function helpTopicFor(code: ErrorCode): HelpTopic | undefined {
  const def: ErrorDef = ERROR_DEFS[code];
  return def.help;
}

/** Fills `{name}` placeholders; unknown placeholders are left visible so they get noticed. */
export function formatErrorMessage(code: ErrorCode, params: ErrorParams = {}): string {
  return ERROR_DEFS[code].message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Placeholders a message expects, e.g. `['mac', 'deviceName']`. */
export function messageParams(code: ErrorCode): string[] {
  return [...ERROR_DEFS[code].message.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '');
}
