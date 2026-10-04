/** UI strings (pt-BR). Server error messages come from the shared catalog (ADR-006). */
export const t = {
  appName: 'UniWake',
  skipToContent: 'Pular para o conteúdo',
  nav: {
    label: 'Navegação principal',
    dashboard: 'Painel',
    devices: 'Dispositivos',
    schedules: 'Agendamentos',
    history: 'Histórico',
    prepare: 'Preparar máquinas',
    settings: 'Configurações',
    health: 'Saúde do sistema',
  },
  user: {
    logout: 'Sair',
    roleAdmin: 'Administrador',
    roleOperator: 'Operador',
  },
  common: {
    loading: 'Carregando…',
    retry: 'Tentar novamente',
    save: 'Salvar',
    cancel: 'Cancelar',
    close: 'Fechar',
  },
  banners: {
    dryRun: 'Modo simulação ativo: nenhum pacote de rede está sendo enviado.',
    demo: 'Modo demonstração: dados e máquinas fictícios.',
  },
  notFound: {
    title: 'Página não encontrada',
    back: 'Voltar ao painel',
  },
} as const;
