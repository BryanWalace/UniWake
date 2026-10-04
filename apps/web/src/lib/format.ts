/** pt-BR date/time formatting (spec §8: dd/mm/aaaa HH:mm, 24 h). */
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const time = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatDateTime(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '—' : dateTime.format(new Date(ms)).replace(',', '');
}

export function formatTime(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '—' : time.format(new Date(ms));
}

/** "4 min 05 s" style durations for countdowns. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export { useNow } from './use-now';
