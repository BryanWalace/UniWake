/**
 * Adds the pinned Node runtime to a staged version (ADR-022, plan §9): downloads the official
 * `win-x64/node.exe` for the version in `.nvmrc` from nodejs.org over HTTPS and checks it against
 * the release's SHASUMS256.txt before it is written. A cached copy in `.tools/node/` is reused only
 * if it still matches.
 *
 *   node scripts/fetch-node.ts [--out build/stage/app]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const DIST = 'https://nodejs.org/dist';
const FILE = 'win-x64/node.exe';

type Fetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export class ChecksumMismatchError extends Error {
  constructor(file: string, expected: string, actual: string) {
    super(`CHECKSUM_MISMATCH: ${file} has SHA-256 ${actual}, SHASUMS256.txt says ${expected}`);
    this.name = 'ChecksumMismatchError';
  }
}

export function pinnedNodeVersion(nvmrc = join(root, '.nvmrc')): string {
  const v = readFileSync(nvmrc, 'utf8').trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`.nvmrc must pin an exact version, found "${v}"`);
  return v;
}

/** The expected SHA-256 of `file` in a SHASUMS256.txt body. */
export function expectedSha256(shasums: string, file: string): string {
  for (const line of shasums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && m[2] === file) return m[1]!;
  }
  throw new Error(`${file} is not listed in SHASUMS256.txt`);
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function download(fetchImpl: Fetch, url: string): Promise<Buffer> {
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`GET ${url} failed: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Writes the verified node.exe to `<out>/node.exe`; never leaves an unverified file behind. */
export async function fetchNodeRuntime(opts: {
  version: string;
  out: string;
  cacheDir: string;
  fetchImpl?: Fetch;
}): Promise<string> {
  const fetchImpl: Fetch = opts.fetchImpl ?? fetch;
  const base = `${DIST}/v${opts.version}`;
  const expected = expectedSha256(
    (await download(fetchImpl, `${base}/SHASUMS256.txt`)).toString('utf8'),
    FILE,
  );
  const cached = join(opts.cacheDir, `node-v${opts.version}-win-x64.exe`);
  let bytes: Buffer | null = existsSync(cached) ? readFileSync(cached) : null;
  if (bytes && sha256(bytes) !== expected) {
    rmSync(cached);
    bytes = null;
  }
  if (!bytes) {
    bytes = await download(fetchImpl, `${base}/${FILE}`);
    const actual = sha256(bytes);
    if (actual !== expected) throw new ChecksumMismatchError(FILE, expected, actual);
    mkdirSync(opts.cacheDir, { recursive: true });
    writeFileSync(cached, bytes);
  }
  const target = join(opts.out, 'node.exe');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.tmp`, bytes);
  renameSync(`${target}.tmp`, target);
  return target;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { out: { type: 'string', default: join(root, 'build/stage/app') } },
  });
  const version = pinnedNodeVersion();
  const file = await fetchNodeRuntime({
    version,
    out: resolve(values.out),
    cacheDir: join(root, '.tools/node'),
  });
  process.stdout.write(`Node ${version} (SHA-256 verified) → ${file}\n`);
}
