/**
 * Room codes for enrollment (FR-008.1): `[A-Z0-9-]{2,16}`, generated from the room name and made
 * unique with a numeric suffix. Examples: "Lab 3" → LAB3, then LAB3-2.
 */
export const ROOM_CODE_RE = /^[A-Z0-9-]{2,16}$/;
const MAX = 16;
const JOINED_MAX = 12;

function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** Base code from a name, before de-duplication. */
export function baseRoomCode(name: string): string {
  const w = words(name);
  let code = w.join('');
  if (code.length > JOINED_MAX) {
    // Long names: initials of words, numbers kept whole ("Laboratório de Informática 2" → LDI2).
    code = w.map((x) => (/^\d+$/.test(x) ? x : x[0])).join('');
  }
  if (code.length < 2) code = `SALA${code}`;
  return code.slice(0, MAX);
}

/** Unique code: base, then base-2, base-3, … trimmed to 16 chars. */
export function suggestRoomCode(name: string, taken: (code: string) => boolean): string {
  const base = baseRoomCode(name);
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, MAX - suffix.length) + suffix;
    if (!taken(candidate)) return candidate;
  }
}
