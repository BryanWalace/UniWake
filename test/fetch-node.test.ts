import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChecksumMismatchError,
  expectedSha256,
  fetchNodeRuntime,
  pinnedNodeVersion,
} from '../scripts/fetch-node';

const EXE = Buffer.from('MZ fake node.exe');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'uniwake-node-'));
  dirs.push(d);
  return d;
};

/** In-memory nodejs.org: no network in tests (constitution §5). */
function fakeDist(files: Record<string, Buffer | string>) {
  const calls: string[] = [];
  const fetchImpl = (url: string) => {
    calls.push(url);
    const body = files[url];
    return Promise.resolve({
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      arrayBuffer: () => {
        const b = Buffer.from(body ?? '');
        return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      },
    });
  };
  return { fetchImpl, calls };
}

const BASE = 'https://nodejs.org/dist/v24.15.0';
const shasums = (hash: string) =>
  `${'a'.repeat(64)}  node-v24.15.0-win-x64.zip\n${hash}  win-x64/node.exe\n`;

describe('Node runtime fetch (M8-T02, ADR-022)', () => {
  it('writes node.exe when it matches SHASUMS256.txt, then reuses the verified cache', async () => {
    const out = temp();
    const cacheDir = temp();
    const dist = fakeDist({
      [`${BASE}/SHASUMS256.txt`]: shasums(sha(EXE)),
      [`${BASE}/win-x64/node.exe`]: EXE,
    });
    await fetchNodeRuntime({ version: '24.15.0', out, cacheDir, fetchImpl: dist.fetchImpl });
    expect(readFileSync(join(out, 'node.exe')).equals(EXE)).toBe(true);
    await fetchNodeRuntime({
      version: '24.15.0',
      out: temp(),
      cacheDir,
      fetchImpl: dist.fetchImpl,
    });
    expect(dist.calls.filter((u) => u.endsWith('node.exe'))).toHaveLength(1);
    expect(dist.calls.every((u) => u.startsWith('https://nodejs.org/'))).toBe(true);
  });

  it('a checksum mismatch fails and leaves no node.exe behind', async () => {
    const out = temp();
    const cacheDir = temp();
    const dist = fakeDist({
      [`${BASE}/SHASUMS256.txt`]: shasums('b'.repeat(64)),
      [`${BASE}/win-x64/node.exe`]: EXE,
    });
    await expect(
      fetchNodeRuntime({ version: '24.15.0', out, cacheDir, fetchImpl: dist.fetchImpl }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(existsSync(join(out, 'node.exe'))).toBe(false);
    expect(existsSync(join(cacheDir, 'node-v24.15.0-win-x64.exe'))).toBe(false);
  });

  it('a tampered cache is discarded and downloaded again', async () => {
    const cacheDir = temp();
    writeFileSync(join(cacheDir, 'node-v24.15.0-win-x64.exe'), 'tampered');
    const dist = fakeDist({
      [`${BASE}/SHASUMS256.txt`]: shasums(sha(EXE)),
      [`${BASE}/win-x64/node.exe`]: EXE,
    });
    const out = temp();
    await fetchNodeRuntime({ version: '24.15.0', out, cacheDir, fetchImpl: dist.fetchImpl });
    expect(readFileSync(join(out, 'node.exe')).equals(EXE)).toBe(true);
  });

  it('fails when the file is not listed or the download fails', async () => {
    expect(() => expectedSha256(shasums('c'.repeat(64)), 'win-arm64/node.exe')).toThrow(
      /not listed/,
    );
    const dist = fakeDist({ [`${BASE}/SHASUMS256.txt`]: shasums(sha(EXE)) });
    await expect(
      fetchNodeRuntime({
        version: '24.15.0',
        out: temp(),
        cacheDir: temp(),
        fetchImpl: dist.fetchImpl,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('the pinned version is the exact one in .nvmrc', () => {
    expect(pinnedNodeVersion()).toMatch(/^24\.\d+\.\d+$/);
    const d = temp();
    writeFileSync(join(d, '.nvmrc'), '24\n');
    expect(() => pinnedNodeVersion(join(d, '.nvmrc'))).toThrow(/exact version/);
  });
});
