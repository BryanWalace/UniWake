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
  'team-mode',
  'remote-shutdown',
  'frozen-labs',
  'backup-migration',
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
  PREPARE_SCRIPT_MISSING: {
    status: 503,
    message:
      'O arquivo prepare-target.ps1 não foi encontrado na instalação do UniWake. Reinstale o UniWake.',
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
  // Modo equipe (FR-201..204)
  TEAM_NOT_IN_TEAM: {
    status: 409,
    message: 'Este PC não está em uma equipe. Use "Parear com outro PC" ou "Entrar em uma equipe".',
  },
  TEAM_ALREADY_MEMBER: {
    status: 409,
    message: 'Este PC já está em uma equipe. Para entrar em outra, use "Sair da equipe" primeiro.',
  },
  TEAM_REPLACE_CONFIRM: {
    status: 422,
    message:
      'Este PC tem cadastros que serão substituídos pelos da equipe. Digite SUBSTITUIR para confirmar (um backup é feito antes).',
  },
  TEAM_PAIRING_NO_CODE: {
    status: 409,
    message:
      'O outro PC não está com um código de pareamento aberto. Clique em "Parear com outro PC" nele e tente de novo.',
  },
  TEAM_PAIRING_WRONG_CODE: {
    status: 422,
    message:
      'Código incorreto. Confira os 6 dígitos mostrados no outro PC ({attemptsLeft} tentativas restantes).',
  },
  TEAM_PAIRING_LOCKED: {
    status: 409,
    message: 'Tentativas esgotadas: o código foi cancelado. Gere um novo código no outro PC.',
  },
  TEAM_PAIRING_UNREACHABLE: {
    status: 502,
    message:
      'Não foi possível conectar ao outro PC ({address}). Verifique se o UniWake está aberto nele, o endereço e o firewall (porta 47102).',
    help: 'team-mode',
  },
  TEAM_PAIRING_FAILED: {
    status: 502,
    message: 'O pareamento foi interrompido. Gere um novo código no outro PC e tente de novo.',
  },
  TEAM_MEMBER_NOT_FOUND: {
    status: 404,
    message: 'PC da equipe não encontrado. Atualize a página.',
  },
  TEAM_CANNOT_REVOKE_SELF: {
    status: 422,
    message: 'Para tirar este PC da equipe, use "Sair da equipe".',
  },
  MISSED_RUN_NOT_FOUND: {
    status: 404,
    message: 'Esse aviso já foi resolvido ou o agendamento foi removido.',
  },
  // v1.3 (plan §15.4). Agent-listener codes go to lab PCs: no detail about why (ADR-043).
  AGENT_TOKEN_INVALID: {
    status: 401,
    message: 'Esta máquina não está autorizada. Execute o comando de "Preparar máquinas" de novo.',
  },
  AGENT_RATE_LIMITED: {
    status: 429,
    message: 'Muitas consultas desta máquina. Ela tenta de novo no próximo minuto.',
  },
  AGENT_PROTOCOL_UNSUPPORTED: {
    status: 422,
    message:
      'Versão do agente não suportada por este UniWake. Execute o comando de preparo de novo.',
  },
  AGENT_SCRIPTS_MISSING: {
    status: 500,
    message:
      'Arquivos do agente ausentes nesta instalação do UniWake. Reinstale ou atualize o UniWake.',
  },
  POWER_TARGET_EMPTY: {
    status: 422,
    message: 'Nenhuma máquina para desligar nessa seleção.',
  },
  POWER_NOT_READY: {
    status: 422,
    message:
      'Nenhuma das máquinas está pronta para desligar. Execute o novo comando de "Preparar máquinas" nelas.',
  },
  POWER_PROTECTED_CONFIRMATION: {
    status: 409,
    message:
      'A seleção inclui máquinas marcadas "Nunca desligar por agendamento". Confirme para desligá-las também.',
  },
  POWER_TEST_NOT_READY: {
    status: 422,
    message:
      'Esta máquina não está pronta para desligar. Execute o novo comando de "Preparar máquinas" nela antes do teste.',
  },
  POWER_TEST_PROTECTED: {
    status: 422,
    message:
      'Esta máquina está marcada "Nunca desligar por agendamento". Desmarque para testar o agendamento.',
  },
  POWER_JOB_NOT_FOUND: {
    status: 404,
    message: 'Esse desligamento não foi encontrado. Atualize a página.',
  },
  // v1.4 "Backup e migração" (spec §6c)
  EXPORT_PASSWORD_REQUIRED: {
    status: 422,
    message: 'Usuários e Desligamento remoto só podem ser exportados com senha.',
  },
  IMPORT_TOO_LARGE: {
    status: 413,
    message: 'Arquivo grande demais para um backup do UniWake (máximo 50 MB).',
  },
  IMPORT_NOT_UNIWAKE: {
    status: 422,
    message: 'Este arquivo não é um backup do UniWake (.uniwake).',
  },
  IMPORT_DAMAGED: {
    status: 422,
    message: 'O arquivo está danificado ou foi alterado. Exporte de novo no PC de origem.',
  },
  IMPORT_NEWER: {
    status: 422,
    message:
      'Arquivo de uma versão mais nova do UniWake ({version}): atualize este PC antes de importar.',
  },
  IMPORT_PASSWORD_REQUIRED: {
    status: 422,
    message: 'Este arquivo tem partes protegidas: digite a senha usada na exportação.',
  },
  IMPORT_BAD_PASSWORD: {
    status: 422,
    message: 'Senha incorreta ou arquivo alterado.',
  },
  IMPORT_IN_TEAM: {
    status: 409,
    message:
      'Este PC está numa equipe: importe num PC fora da equipe e depois pareie, ou saia da equipe.',
  },
  IMPORT_EXPIRED: {
    status: 404,
    message: 'O arquivo enviado expirou (15 minutos). Escolha o arquivo de novo.',
  },
  IMPORT_REPLACE_INCOMPLETE: {
    status: 422,
    message: 'Para substituir, o arquivo precisa ter Cadastro e Agendamentos.',
  },
  MIGRATION_UNDO_UNAVAILABLE: {
    status: 409,
    message: 'Não há importação recente para desfazer.',
  },
  AGENT_STANDBY: {
    status: 503,
    message: 'Este UniWake está em espera depois de uma importação.',
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
