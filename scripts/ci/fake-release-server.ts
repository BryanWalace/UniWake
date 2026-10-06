// CI only (M8-T12): stands in for GitHub's release API on loopback for a test build made with
// `--test-update-api http://127.0.0.1:<port>` (ADR-025).
//   node scripts/ci/fake-release-server.ts --port 47199 --version 0.0.4 --installer <setup.exe>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '47199' },
    version: { type: 'string' },
    installer: { type: 'string' },
  },
});
if (!values.version || !values.installer) {
  console.error('usage: fake-release-server.ts --port <p> --version <v> --installer <file>');
  process.exit(64);
}
const bytes = readFileSync(values.installer);
const sha = createHash('sha256').update(bytes).digest('hex');
const base = `http://127.0.0.1:${values.port}`;

const release = {
  tag_name: `v${values.version}`,
  name: `UniWake ${values.version}`,
  body: `Versão de teste ${values.version}.`,
  draft: false,
  prerelease: false,
  published_at: new Date().toISOString(),
  assets: [
    {
      name: 'UniWake-Setup.exe',
      browser_download_url: `${base}/download/UniWake-Setup.exe`,
      size: bytes.length,
    },
    {
      name: 'UniWake-Setup.exe.sha256',
      browser_download_url: `${base}/download/UniWake-Setup.exe.sha256`,
      size: 84,
    },
  ],
};

createServer((req, res) => {
  console.log(req.method, req.url);
  if (req.url === '/repos/BryanWalace/UniWake/releases/latest') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(release));
  } else if (req.url === '/download/UniWake-Setup.exe') {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': bytes.length,
    });
    res.end(bytes);
  } else if (req.url === '/download/UniWake-Setup.exe.sha256') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`${sha}  UniWake-Setup.exe\n`);
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(Number(values.port), '127.0.0.1', () => {
  console.log(`fake release ${values.version} at ${base} (sha256 ${sha})`);
});
