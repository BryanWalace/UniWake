/**
 * Writes automatic exports (ADR-052). Paths may be network shares (`\servidor\pasta`); the service
 * account (LocalSystem) reaches them as the computer account.
 */
import { readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExportFolder } from '../application/migration/auto-export';

export const nodeExportFolder: ExportFolder = {
  write(folder, name, bytes) {
    const tmp = join(folder, `${name}.tmp`);
    writeFileSync(tmp, bytes);
    renameSync(tmp, join(folder, name));
  },
  list: (folder) => readdirSync(folder),
  remove: (folder, name) => rmSync(join(folder, name), { force: true }),
};
