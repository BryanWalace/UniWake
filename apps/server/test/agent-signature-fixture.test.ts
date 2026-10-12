/**
 * M16-T01 / ADR-044: the Node side of the signature fixture that Pester verifies in Windows
 * PowerShell 5.1 (scripts/tests/agent-signature.Tests.ps1).
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Fixture {
  key: { kty: 'RSA'; n: string; e: string };
  keyId: string;
  nonce: string;
  bodyBase64: string;
  signature: string;
  tamperedBodyBase64: string;
}

const fx = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'packages',
      'shared',
      'fixtures',
      'agent',
      'signature.json',
    ),
    'utf8',
  ),
) as Fixture;
const key = createPublicKey({ key: fx.key, format: 'jwk' });
const signed = (body: Buffer, nonce = fx.nonce) =>
  Buffer.concat([Buffer.from(`uniwake-agent-v1\n${nonce}\n`, 'utf8'), body]);

describe('agent signature fixture (ADR-044)', () => {
  it('is an RSA-3072 key whose signature verifies over the nonce and body', () => {
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(3072);
    const body = Buffer.from(fx.bodyBase64, 'base64');
    expect(verify('sha256', signed(body), key, Buffer.from(fx.signature, 'base64'))).toBe(true);
  });

  it('fails for the tampered body and for another nonce', () => {
    const sig = Buffer.from(fx.signature, 'base64');
    expect(verify('sha256', signed(Buffer.from(fx.tamperedBodyBase64, 'base64')), key, sig)).toBe(
      false,
    );
    expect(verify('sha256', signed(Buffer.from(fx.bodyBase64, 'base64'), 'x'), key, sig)).toBe(
      false,
    );
  });

  it('has the RFC 7638 key id', () => {
    const id = createHash('sha256')
      .update(`{"e":"${fx.key.e}","kty":"RSA","n":"${fx.key.n}"}`)
      .digest('base64url');
    expect(id).toBe(fx.keyId);
  });
});
