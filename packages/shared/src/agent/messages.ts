/**
 * The warning text a lab PC shows (FR-304.1a): the main text keeps `{hora}`, the postpone suffix
 * keeps `{n}`; both are settings with the owner's defaults (Q-8).
 */
import { SHUTDOWN_COMMENT_MAX } from './constants';

export const WARNING_TIME_PLACEHOLDER = '{hora}';
export const POSTPONE_COUNT_PLACEHOLDER = '{n}';

/** The text for shutdown time `hhmm` ("22:40") and `postponesLeft` remaining postpones. */
export function formatWarning(
  templates: { warning: string; postpone: string },
  hhmm: string,
  postponesLeft: number,
): string {
  const main = templates.warning.split(WARNING_TIME_PLACEHOLDER).join(hhmm);
  if (postponesLeft <= 0) return main;
  return `${main} ${templates.postpone.split(POSTPONE_COUNT_PLACEHOLDER).join(String(postponesLeft))}`;
}

/** The comment for `shutdown /c` (no suffix: the native warning cannot postpone). */
export function shutdownComment(warningTemplate: string, hhmm: string): string {
  return formatWarning({ warning: warningTemplate, postpone: '' }, hhmm, 0).slice(
    0,
    SHUTDOWN_COMMENT_MAX,
  );
}
