import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../src/adapters/node-fs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('NodeFileSystem (FileSystem port)', () => {
  it('writes atomically, hashes, sizes, lists and removes; reports free space', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uniwake-fs-'));
    dirs.push(dir);
    const fs = new NodeFileSystem();
    const file = join(dir, 'sub', 'plan.json');
    await fs.mkdirp(join(dir, 'sub'));
    await fs.writeText(file, 'conteúdo');
    expect(readdirSync(join(dir, 'sub'))).toEqual(['plan.json']); // no .tmp left behind
    expect(await fs.readText(file)).toBe('conteúdo');
    expect(await fs.size(file)).toBe(Buffer.byteLength('conteúdo'));
    expect(await fs.sha256(file)).toBe(createHash('sha256').update('conteúdo').digest('hex'));
    expect(await fs.list(join(dir, 'sub'))).toEqual(['plan.json']);
    expect(await fs.freeBytes(dir)).toBeGreaterThan(0);
    await fs.remove(file);
    expect(await fs.exists(file)).toBe(false);
    await fs.remove(file); // removing twice is fine
  });
});

describe('install dir detection (plan §9)', () => {
  it('is the folder above versions/<ver> for an installed bundle, null from source', async () => {
    const { resolveInstallDir } = await import('../src/hub');
    const base = join(tmpdir(), 'UniWake');
    expect(resolveInstallDir(join(base, 'versions', '1.2.3'))).toBe(base);
    expect(resolveInstallDir(join(base, 'Versions', '1.2.3'))).toBe(base);
    expect(resolveInstallDir(join(base, 'apps', 'server', 'src'))).toBeNull();
  });
});
