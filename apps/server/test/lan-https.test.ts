import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { CertificateError, PanelCertificateStore } from '../src/adapters/panel-certificate';
import { NodeProcessRunner } from '../src/adapters/process-runner';
import { CONFIG_DEFAULTS, type Config } from '../src/config';
import { createHub, type Hub } from '../src/hub';
import { apiHarness, type ApiHarness } from './helpers/api';

const dirs: string[] = [];
const hubs: Hub[] = [];
const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hubs.splice(0)) await h.stop();
  for (const h of hs.splice(0)) await h.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix = 'uniwake-lan-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** A throwaway self-signed PFX for 127.0.0.1, made with openssl at test time (no key in git). */
function testPfx(password = 'senha-do-pfx'): Buffer | null {
  const d = tempDir('uniwake-pfx-');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=uniwake-test',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-keyout',
        join(d, 'key.pem'),
        '-out',
        join(d, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    execFileSync(
      'openssl',
      [
        'pkcs12',
        '-export',
        '-inkey',
        join(d, 'key.pem'),
        '-in',
        join(d, 'cert.pem'),
        '-out',
        join(d, 'panel.pfx'),
        '-passout',
        `pass:${password}`,
      ],
      { stdio: 'ignore' },
    );
    return readFileSync(join(d, 'panel.pfx'));
  } catch {
    return null; // no openssl here
  }
}
const PFX = testPfx();

function config(dataDir: string): Config {
  return {
    ...CONFIG_DEFAULTS,
    panelPort: 0,
    agentPort: 0,
    agentBind: '127.0.0.1',
    dataDir,
    demo: false,
  };
}
const silent = pino({ level: 'silent' });

/** A data dir whose settings turn LAN access on for 127.0.0.1. */
async function lanDataDir(): Promise<string> {
  const dir = tempDir();
  const first = await createHub({ config: config(dir), logger: silent });
  first.services.settings.update(
    { 'panel.lanEnabled': true, 'panel.lanAddress': '127.0.0.1' },
    null,
  );
  await first.stop();
  return dir;
}

function get(
  kind: 'http' | 'https',
  port: number,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  const send = kind === 'https' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      {
        host: '127.0.0.1',
        port,
        path,
        method: init.method ?? 'GET',
        headers: init.body
          ? { 'content-type': 'application/json', origin: `https://127.0.0.1:${port}` }
          : {},
        rejectUnauthorized: false, // self-signed, like a browser after "accept the risk"
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
    req.end(init.body);
  });
}
const portOf = (addr: string) => Number(addr.split(':').pop());

describe('LAN exposure (FR-006.4, ADR-012)', () => {
  it('AC-006-05: with LAN off the panel listens on 127.0.0.1 only', async () => {
    const hub = await createHub({ config: config(tempDir()), logger: silent });
    hubs.push(hub);
    await hub.start();
    const a = hub.addresses();
    expect(a.panel.startsWith('127.0.0.1:')).toBe(true);
    expect(a.panelLan).toBeUndefined();
  });

  it.skipIf(!PFX)(
    'AC-006-08: with LAN on, that address speaks TLS only and its cookies are Secure',
    async () => {
      const dir = await lanDataDir();
      const hub = await createHub({
        config: config(dir),
        logger: silent,
        panelCertificate: () => Promise.resolve({ pfx: PFX!, passphrase: 'senha-do-pfx' }),
      });
      hubs.push(hub);
      await hub.start();
      const lanPort = portOf(hub.addresses().panelLan!);
      const health = await get('https', lanPort, '/api/health');
      expect(health.status).toBe(200);
      expect(health.headers['x-frame-options']).toBe('DENY');
      await expect(get('http', lanPort, '/api/health')).rejects.toThrow(); // plain HTTP is refused

      await hub.services.auth.setup(
        { username: 'admin', password: 'cadeira-azul-do-lab' },
        { ip: '127.0.0.1', remoteAddress: '127.0.0.1' },
      );
      const body = JSON.stringify({ username: 'admin', password: 'cadeira-azul-do-lab' });
      const overTls = await get('https', lanPort, '/api/auth/login', { method: 'POST', body });
      expect(overTls.status).toBe(200);
      expect(String(overTls.headers['set-cookie'])).toMatch(/; Secure/);
      const local = await get('http', portOf(hub.addresses().panel), '/api/auth/login', {
        method: 'POST',
        body,
      });
      expect(String(local.headers['set-cookie'])).not.toMatch(/; Secure/);
    },
  );

  it('without a usable certificate the local panel still starts and a notice explains why', async () => {
    const dir = await lanDataDir();
    const hub = await createHub({ config: config(dir), logger: silent, certScriptPath: null });
    hubs.push(hub);
    await hub.start();
    expect(hub.addresses().panelLan).toBeUndefined();
    const notice = hub.services.notices.list().find((n) => n.type === 'lan_error');
    expect(String(notice?.data.message)).toMatch(/certificado|PFX/i);
  });
});

describe('panel certificate store (ADR-026)', () => {
  it.skipIf(!PFX)(
    'stores a valid PFX, rejects garbage or a wrong password, and reads it back',
    async () => {
      const store = new PanelCertificateStore(tempDir(), new NodeProcessRunner(), null, 'linux');
      expect(() => store.save(Buffer.from('nao e um pfx'), 'x')).toThrow(CertificateError);
      expect(() => store.save(PFX!, 'senha-errada')).toThrow(
        'Certificado inválido ou senha incorreta.',
      );
      store.save(PFX!, 'senha-do-pfx');
      const loaded = await store.loadOrCreate('127.0.0.1');
      expect(loaded.passphrase).toBe('senha-do-pfx');
      expect(loaded.pfx.equals(PFX!)).toBe(true);
    },
  );

  it.skipIf(!PFX)(
    'POST /api/settings/certificate: admins upload a PFX; bad ones get a field error',
    async () => {
      const h = await apiHarness();
      hs.push(h);
      const certsDir = tempDir();
      h.services.panelCertificates = new PanelCertificateStore(
        certsDir,
        new NodeProcessRunner(),
        null,
      );
      const admin = await h.as('admin');
      const post = (payload: object, cookie = admin) =>
        h.inject({ method: 'POST', url: '/api/settings/certificate', cookie, payload });
      const bad = await post({ pfxBase64: Buffer.from('lixo').toString('base64'), password: 'x' });
      expect(bad.statusCode).toBe(422);
      expect(bad.json<{ details: { message: string }[] }>().details[0]!.message).toBe(
        'Certificado inválido ou senha incorreta.',
      );
      const ok = await post({ pfxBase64: PFX!.toString('base64'), password: 'senha-do-pfx' });
      expect(ok.json()).toEqual({ restartRequired: true });
      expect(existsSync(join(certsDir, 'panel.pfx'))).toBe(true);
      expect(
        (await post({ pfxBase64: 'eA==', password: '' }, await h.as('operator'))).statusCode,
      ).toBe(403);
    },
  );

  // Opt-in: it creates (and removes) a certificate in the current user's Windows store.
  it.skipIf(process.platform !== 'win32' || process.env.UNIWAKE_CERT_CONTRACT !== '1')(
    'Windows contract: new-panel-cert.ps1 makes a PFX that Node can serve',
    async () => {
      const store = new PanelCertificateStore(
        tempDir(),
        new NodeProcessRunner(),
        join(import.meta.dirname, '..', 'helper', 'new-panel-cert.ps1'),
      );
      const cert = await store.loadOrCreate('127.0.0.1');
      expect(cert.pfx.length).toBeGreaterThan(1000);
    },
    90_000,
  );
});
