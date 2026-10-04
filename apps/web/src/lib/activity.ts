/**
 * User activity for the session idle timeout (R-M4-01). Requests sent while the user has not
 * touched the page for a minute (polling, live-update refetches) carry `X-UniWake-Idle: 1`, so the
 * hub does not count them as activity: a panel left open on a lab PC still logs out when idle.
 */
export const IDLE_AFTER_MS = 60_000;
export const IDLE_HEADER = 'x-uniwake-idle';

let lastActivity = Date.now();

export function noteActivity(at = Date.now()): void {
  lastActivity = at;
}

export function isUserIdle(now = Date.now()): boolean {
  return now - lastActivity > IDLE_AFTER_MS;
}

if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(type, () => noteActivity(), { capture: true, passive: true });
  }
}
