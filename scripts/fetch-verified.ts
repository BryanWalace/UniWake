/**
 * Downloads a build input (Node runtime, WinSW) and checks its SHA-256 before it is written
 * anywhere it could be used (ADR-022). A cached copy is reused only while it still matches.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Fetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export class ChecksumMismatchError extends Error {
  constructor(what: string, expected: string, actual: string) {
    super(`CHECKSUM_MISMATCH: ${what} has SHA-256 ${actual}, expected ${expected}`);
    this.name = 'ChecksumMismatchError';
  }
}

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export async function download(fetchImpl: Fetch, url: string): Promise<Buffer> {
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`GET ${url} failed: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Writes `dest` only with bytes whose SHA-256 is `expected`; never leaves an unverified file. */
export async function fetchVerified(opts: {
  url: string;
  expected: string;
  dest: string;
  cacheFile: string;
  fetchImpl?: Fetch;
}): Promise<string> {
  const expected = opts.expected.toLowerCase();
  let bytes: Buffer | null = existsSync(opts.cacheFile) ? readFileSync(opts.cacheFile) : null;
  if (bytes && sha256(bytes) !== expected) {
    rmSync(opts.cacheFile);
    bytes = null;
  }
  if (!bytes) {
    bytes = await download(opts.fetchImpl ?? fetch, opts.url);
    const actual = sha256(bytes);
    if (actual !== expected) throw new ChecksumMismatchError(opts.url, expected, actual);
    mkdirSync(dirname(opts.cacheFile), { recursive: true });
    writeFileSync(opts.cacheFile, bytes);
  }
  mkdirSync(dirname(opts.dest), { recursive: true });
  writeFileSync(`${opts.dest}.tmp`, bytes);
  renameSync(`${opts.dest}.tmp`, opts.dest);
  return opts.dest;
}
