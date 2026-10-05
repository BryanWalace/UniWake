/**
 * "Testar WoL desta máquina" (FR-007.4): wait until the computer is off, 30 s more for the
 * network card to arm, send, and wait for it to come back within the verification window.
 */
export const TEST_WOL_STATES = [
  'aguardando_desligar',
  'aguardando_placa',
  'aguardando_ligar',
  'sucesso',
  'nao_acordou',
  'cancelado',
  'falhou',
] as const;
export type TestWolState = (typeof TEST_WOL_STATES)[number];

export const TEST_WOL_ACTIVE_STATES: readonly TestWolState[] = [
  'aguardando_desligar',
  'aguardando_placa',
  'aguardando_ligar',
];

export const TEST_WOL_STATE_LABEL: Record<TestWolState, string> = {
  aguardando_desligar: 'Aguardando o computador desligar',
  aguardando_placa: 'Aguardando a placa de rede ficar pronta',
  aguardando_ligar: 'Magic Packet enviado; aguardando o computador ligar',
  sucesso: 'Sucesso: o computador ligou pela rede',
  nao_acordou: 'Não acordou',
  cancelado: 'Cancelado',
  falhou: 'Não foi possível testar',
};

export interface TestWolRun {
  id: number;
  deviceId: number;
  deviceName: string;
  state: TestWolState;
  requestedBy: string | null;
  startedAt: number;
  /** When the computer was seen off (two missed probes in a row). */
  offlineAt: number | null;
  sentAt: number | null;
  finishedAt: number | null;
  jobId: number | null;
  detail: string | null;
}
