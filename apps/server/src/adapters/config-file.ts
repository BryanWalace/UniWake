/**
 * `<dataDir>/config.json` (bootstrap settings: ports, log level). Written atomically (temp file +
 * rename) and only read at start-up, so changes apply after a restart (constitution §2.4).
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { BootstrapValues, ConfigFileStore } from '../application/settings/settings-admin';

export class JsonConfigFile implements ConfigFileStore {
  constructor(private readonly path: string) {}

  read(): Partial<BootstrapValues> {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch {
      return {};
    }
    try {
      // Notepad saves UTF-8 with a BOM (U+FEFF).
      const json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
      return typeof json === 'object' && json !== null ? json : {};
    } catch {
      return {};
    }
  }

  write(values: Partial<BootstrapValues>): void {
    const next = { ...this.read(), ...values };
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.path);
  }
}
