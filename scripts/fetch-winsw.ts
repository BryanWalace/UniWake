/**
 * WinSW 2.12.0 x64, the Windows service wrapper (ADR-021), pinned by SHA-256. The installer ships it
 * renamed to UniWakeService.exe.
 *
 *   node scripts/fetch-winsw.ts [--out build/stage/WinSW-x64.exe]
 */
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fetchVerified } from './fetch-verified.ts';

const root = resolve(import.meta.dirname, '..');

export const WINSW = {
  version: '2.12.0',
  url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe',
  sha256: '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da',
} as const;

if (import.meta.main) {
  const { values } = parseArgs({
    options: { out: { type: 'string', default: join(root, 'build/stage/WinSW-x64.exe') } },
  });
  const file = await fetchVerified({
    url: WINSW.url,
    expected: WINSW.sha256,
    dest: resolve(values.out),
    cacheFile: join(root, '.tools/winsw', `WinSW-${WINSW.version}-x64.exe`),
  });
  process.stdout.write(`WinSW ${WINSW.version} (SHA-256 verified) → ${file}\n`);
}
