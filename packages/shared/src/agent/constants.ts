/**
 * Values fixed by the owner on 2026-10-11 (spec §6b "Owner decisions") and protocol limits
 * (plan §15.7). Constants, not settings: changing one is a spec change.
 */

/** Agent wire protocol (check-in request/answer, enrollment extension). */
export const AGENT_PROTOCOL = 1;

/** Q-4: the agenda covers the next 14 days; nothing outside the window runs. */
export const AGENDA_DAYS = 14;
/** Q-9: a PC that slept through T shuts down only if at most this late (and before its next wake). */
export const LATE_WAKE_MAX_MINUTES = 60;
/** Q-5: uninterrupted ping/TCP without a check-in before "Desligamento remoto perdido". */
export const LOST_AFTER_MINUTES = 15;
/** Q-7: manual "Desligar" default warning, without postpone. */
export const MANUAL_WARNING_MINUTES = 1;
export const TOKEN_ROTATION_DAYS = 30;
export const ORDER_EXPIRY_MINUTES = 120;

export const WARNING_MINUTES_MAX = 30;
export const POSTPONE_MAX_LIMIT = 5;
export const POSTPONE_MINUTES_MIN = 5;
export const POSTPONE_MINUTES_MAX = 60;

export const CHECKIN_MAX_BODY_BYTES = 64 * 1024;
export const CHECKIN_MAX_REPORTS = 50;
export const AGENDA_MAX_ITEMS = 200;
export const CHECKIN_PER_TOKEN_PER_MINUTE = 6;
export const CHECKIN_PER_IP_PER_MINUTE = 60;

/** Q-8 defaults; `{hora}` and `{n}` must survive customization (FR-304.1a). */
export const DEFAULT_WARNING_MESSAGE =
  'Este computador será desligado às {hora} pela equipe de TI. Salve seus arquivos: o que não for salvo será perdido.';
export const DEFAULT_POSTPONE_MESSAGE = 'Você pode adiar mais {n} vez(es).';
/** `shutdown /c` accepts at most 512 characters. */
export const SHUTDOWN_COMMENT_MAX = 512;
