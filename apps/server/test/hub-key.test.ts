/**
 * M16-T02 (ADR-044): the hub's signing key is made once, kept protected, reloaded on restart,
 * replaced when it cannot be opened on this PC, and signs the bytes lab PCs verify.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SecretProtector } from '../src/application/ports';
import {
  HubKeyService,
  jwkThumbprint,
  signedBytes,
  verifySigned,
} from '../src/application/power/hub-key';
import { DevSecretProtector } from '../src/adapters/secret-protector';
import { SqliteHubKeysRepo } from '../src/db/repositories/hub-keys-repo';
import { FakeClock } from './fakes/fake-clock';
import { MemoryLogger } from './fakes/system-fakes';
import { T0, testDb } from './helpers/db';

function service(db = testDb(), protector: SecretProtector = new DevSecretProtector()) {
  const logger = new MemoryLogger();
  const s = new HubKeyService({
    repo: new SqliteHubKeysRepo(db),
    protector,
    clock: new FakeClock(T0),
    logger,
  });
  return { s, db, logger };
}

const rows = (db: ReturnType<typeof testDb>) =>
  db.all<{ key_id: string; private_blob: Uint8Array; retired_at: number | null }>(
    'SELECT key_id, private_blob, retired_at FROM hub_keys ORDER BY retired_at IS NULL, key_id',
  );

describe('hub signing key (ADR-044)', () => {
  it('is made once on first start: RSA-3072, stored protected, id = RFC 7638 thumbprint', async () => {
    const { s, db } = service();
    await s.init();
    const key = s.publicKey();
    expect(Buffer.from(key.n, 'base64url').length * 8).toBe(3072);
    expect(key.e).toBe('AQAB');
    expect(s.keyId()).toBe(jwkThumbprint(key));
    const [row] = rows(db);
    expect(row!.key_id).toBe(s.keyId());
    // The stored blob is the protector's output: it opens to the key, and holds no run of it.
    const blob = Buffer.from(row!.private_blob);
    const der = await new DevSecretProtector().unprotect(blob);
    const opened = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    expect(createPublicKey(opened).export({ format: 'jwk' }).n).toBe(key.n);
    expect(blob.includes(der.subarray(0, 64))).toBe(false);
  });

  it('signs the nonce and the exact body bytes; another nonce or body does not verify', async () => {
    const { s } = service();
    await s.init();
    const body = Buffer.from('{"msg":"desligar às 22:40"}', 'utf8');
    const sig = s.sign('nonce-1', body);
    expect(verifySigned(s.publicKey(), 'nonce-1', body, sig)).toBe(true);
    expect(verifySigned(s.publicKey(), 'nonce-2', body, sig)).toBe(false);
    expect(verifySigned(s.publicKey(), 'nonce-1', Buffer.from('{}'), sig)).toBe(false);
    expect(signedBytes('n', Buffer.from('b')).toString('utf8')).toBe('uniwake-agent-v1\nn\nb');
  });

  it('keeps the same key across restarts', async () => {
    const first = service();
    await first.s.init();
    const again = service(first.db);
    await again.s.init();
    expect(again.s.keyId()).toBe(first.s.keyId());
    expect(rows(first.db)).toHaveLength(1);
    const body = Buffer.from('x');
    expect(verifySigned(first.s.publicKey(), 'n', body, again.s.sign('n', body))).toBe(true);
  });

  it('retires a key that cannot be opened on this PC (restored elsewhere) and makes a new one', async () => {
    const first = service();
    await first.s.init();
    const broken: SecretProtector = {
      protect: (b) => new DevSecretProtector().protect(b),
      unprotect: () => Promise.reject(new Error('DPAPI: chave de outro computador')),
    };
    const again = service(first.db, broken);
    await again.s.init();
    expect(again.s.keyId()).not.toBe(first.s.keyId());
    const all = rows(first.db);
    expect(all.map((r) => r.retired_at === null)).toEqual([false, true]);
    expect(again.logger.entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('refuses to sign before init', () => {
    const { s } = service();
    expect(() => s.sign('n', Buffer.from('x'))).toThrow(/not loaded/);
    expect(() => s.keyId()).toThrow(/not loaded/);
  });
});
