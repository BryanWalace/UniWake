import { WEEKDAY_LABELS } from '@uniwake/shared';

/** "Seg a Sex", "Todos os dias", "Sáb e Dom" or "Seg, Qua, Sex" (Mon=1 … Sun=64). */
export function weekdaysLabel(mask: number): string {
  if (mask === 127) return 'Todos os dias';
  if (mask === 31) return 'Seg a Sex';
  if (mask === 96) return 'Sáb e Dom';
  return WEEKDAY_LABELS.filter((_, i) => mask & (1 << i)).join(', ');
}

/** Brazilian zones first; the hub default is America/Sao_Paulo. */
export const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'America/Noronha',
] as const;
