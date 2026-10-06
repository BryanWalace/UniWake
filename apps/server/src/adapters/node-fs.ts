/** FileSystem port on node:fs (plan §3): atomic writes, streamed hashes, free space via statfs. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import type { FileSystem } from '../application/ports';

export class NodeFileSystem implements FileSystem {
  readText(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async writeText(path: string, content: string): Promise<void> {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, path);
  }

  async exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false,
    );
  }

  remove(path: string): Promise<void> {
    return rm(path, { force: true, recursive: true });
  }

  list(dir: string): Promise<string[]> {
    return readdir(dir);
  }

  async size(path: string): Promise<number> {
    return (await stat(path)).size;
  }

  async mkdirp(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  async freeBytes(path: string): Promise<number> {
    const s = await statfs(path);
    return s.bavail * s.bsize;
  }

  sha256(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      createReadStream(path)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', () => resolve(hash.digest('hex')))
        .on('error', reject);
    });
  }
}
