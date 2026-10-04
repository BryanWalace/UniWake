/**
 * Starts a hub for Playwright with a fresh data dir and the built web panel.
 * Run: node --import tsx scripts/e2e-server.ts   (ports 47190/47191, loopback only)
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../apps/server/src/main.ts';

const dataDir = join(process.cwd(), '.e2e-data');
rmSync(dataDir, { recursive: true, force: true });

process.env.UNIWAKE_PANEL_PORT ??= '47190';
process.env.UNIWAKE_AGENT_PORT ??= '47191';
process.env.UNIWAKE_AGENT_BIND ??= '127.0.0.1';
process.env.UNIWAKE_WEB_DIR ??= join(process.cwd(), 'apps', 'web', 'dist');
process.env.UNIWAKE_LOG_LEVEL ??= 'warn';

const code = await main(['--data-dir', dataDir, ...process.argv.slice(2)]);
process.exit(code);
