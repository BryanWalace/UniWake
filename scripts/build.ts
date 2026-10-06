/**
 * Builds the files of one installed version (ADR-022, plan §9) into `<out>`:
 *   server.mjs (+ updater.mjs once it exists), web/, scripts/prepare-target.ps1, helper/*.ps1,
 *   VERSION.
 * The Node runtime (M8-T02) and the installer (M8-T03) are added by later steps.
 *
 *   node scripts/build.ts [--version 1.2.3 | v1.2.3] [--out build/stage/app] [--skip-web]
 *                         [--test-update-api http://127.0.0.1:47199]
 *
 * --test-update-api is for CI's fake release server only (ADR-025): it must be a loopback http URL,
 * and release builds never pass it.
 *
 * The version comes from the tag in CI (`--version $GITHUB_REF_NAME`); `0.0.0-dev` otherwise.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** `v1.2.3` or `1.2.3` → `1.2.3`; anything else is refused (the hub compares SemVer, FR-001.2). */
export function normalizeVersion(input: string | undefined): string {
  const v = (input ?? '0.0.0-dev').replace(/^v/, '');
  if (!SEMVER.test(v)) throw new Error(`not a SemVer version: ${input}`);
  return v;
}

// Bundled CommonJS dependencies (pino, fastify plugins) still call require/__dirname.
const BANNER = [
  "import { createRequire as __uwCreateRequire } from 'node:module';",
  "import { fileURLToPath as __uwFileUrlToPath } from 'node:url';",
  "import { dirname as __uwDirname } from 'node:path';",
  'const require = __uwCreateRequire(import.meta.url);',
  'const __filename = __uwFileUrlToPath(import.meta.url);',
  'const __dirname = __uwDirname(__filename);',
].join('\n');

/** Only a loopback http server may stand in for GitHub in a test build (ADR-025). */
export function testUpdateApi(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(url)) {
    throw new Error(`--test-update-api must be http://127.0.0.1:<port>, got ${url}`);
  }
  return url;
}

export async function buildApp(opts: {
  version: string;
  out: string;
  skipWeb: boolean;
  testUpdateApi?: string;
}) {
  const out = resolve(opts.out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const entries: Record<string, string> = { server: join(root, 'apps/server/src/main.ts') };
  const updater = join(root, 'apps/server/src/updater/main.ts');
  if (existsSync(updater)) entries.updater = updater;
  await build({
    entryPoints: entries,
    outdir: out,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    banner: { js: BANNER },
    define: {
      __APP_VERSION__: JSON.stringify(opts.version),
      ...(opts.testUpdateApi ? { __UPDATE_API__: JSON.stringify(opts.testUpdateApi) } : {}),
    },
    legalComments: 'linked',
    logLevel: 'warning',
  });

  if (!opts.skipWeb) {
    execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
      cwd: join(root, 'apps/web'),
      stdio: 'inherit',
    });
    cpSync(join(root, 'apps/web/dist'), join(out, 'web'), { recursive: true });
  }

  mkdirSync(join(out, 'scripts'));
  cpSync(join(root, 'scripts/prepare-target.ps1'), join(out, 'scripts/prepare-target.ps1'));
  mkdirSync(join(out, 'helper'));
  for (const f of readdirSync(join(root, 'apps/server/helper'))) {
    if (f.endsWith('.ps1')) cpSync(join(root, 'apps/server/helper', f), join(out, 'helper', f));
  }
  mkdirSync(join(out, 'data'));
  cpSync(join(root, 'apps/server/data/oui.tsv.gz'), join(out, 'data/oui.tsv.gz'));
  writeFileSync(join(out, 'VERSION'), `${opts.version}\n`);
  return out;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      out: { type: 'string', default: join(root, 'build/stage/app') },
      'skip-web': { type: 'boolean', default: false },
      'test-update-api': { type: 'string' },
    },
  });
  const version = normalizeVersion(values.version ?? process.env.UNIWAKE_VERSION);
  const api = testUpdateApi(values['test-update-api']);
  const out = await buildApp({
    version,
    out: values.out,
    skipWeb: values['skip-web'],
    ...(api ? { testUpdateApi: api } : {}),
  });
  process.stdout.write(`UniWake ${version} → ${out}\n`);
}
