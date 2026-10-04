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
// Specs build their own inventory; simulated machines boot within seconds instead of minutes.
process.env.UNIWAKE_DEMO_SEED ??= '0';
process.env.UNIWAKE_DEMO_WAKE_MS ??= '1000-3000';

// --demo forces dry-run: E2E tests must never send real magic packets (CLAUDE.md, constitution §5).
const code = await main(['--data-dir', dataDir, '--demo', ...process.argv.slice(2)]);
process.exit(code);
