/**
 * The hub's signing key (ADR-044): RSA-3072, made on first start of v1.3, private part kept with
 * the secret protector (DPAPI LocalMachine on Windows). Every answer that can make a lab PC act is
 * signed over the PC's nonce; PCs pin the key by its RFC 7638 thumbprint (`-HubKeyId`).
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPair,
  type KeyObject,
  sign,
  verify,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { Clock, Logger, SecretProtector } from '../ports';

/** RSA public key as JWK members (base64url), the form lab PCs import (M16-T01). */
export interface PublicJwk {
  n: string;
  e: string;
}

export interface HubKeyRow {
  keyId: string;
  publicJwk: PublicJwk;
  privateBlob: Buffer;
  createdAt: number;
}

export interface HubKeysRepo {
  /** The key in use (not retired), if any. */
  active(): HubKeyRow | undefined;
  insert(row: HubKeyRow): void;
  retire(keyId: string, at: number): void;
}

export interface HubKeyDeps {
  repo: HubKeysRepo;
  protector: SecretProtector;
  clock: Clock;
  logger: Logger;
  /** Key size; tests may pass a smaller one only through this seam (production: 3072). */
  modulusLength?: number;
}

export const SIGNED_PREFIX = 'uniwake-agent-v1';

/** RFC 7638 thumbprint: SHA-256 over the required members in lexicographic order, base64url. */
export function jwkThumbprint(k: PublicJwk): string {
  return createHash('sha256').update(`{"e":"${k.e}","kty":"RSA","n":"${k.n}"}`).digest('base64url');
}

/** The exact bytes a signature covers: prefix, nonce, then the body as sent. */
export function signedBytes(nonce: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${SIGNED_PREFIX}\n${nonce}\n`, 'utf8'), body]);
}

/** Checks a signature with a public JWK (tests, and the team hub list later). */
export function verifySigned(key: PublicJwk, nonce: string, body: Buffer, signature: string) {
  const pub = createPublicKey({ key: { kty: 'RSA', ...key }, format: 'jwk' });
  return verify('sha256', signedBytes(nonce, body), pub, Buffer.from(signature, 'base64'));
}

const generate = promisify(generateKeyPair);

interface Loaded {
  keyId: string;
  publicJwk: PublicJwk;
  privateKey: KeyObject;
}

export class HubKeyService {
  private loaded: Loaded | null = null;
  private initializing: Promise<void> | null = null;

  constructor(private readonly d: HubKeyDeps) {}

  /**
   * Loads the key, or makes one. A key that cannot be opened here (restored from another PC) is
   * retired. Calls made while one is running share it (M16-D: never two active keys).
   */
  init(): Promise<void> {
    this.initializing ??= this.load().finally(() => {
      this.initializing = null;
    });
    return this.initializing;
  }

  private async load(): Promise<void> {
    const row = this.d.repo.active();
    if (row) {
      try {
        const der = await this.d.protector.unprotect(row.privateBlob);
        const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
        this.loaded = { keyId: row.keyId, publicJwk: row.publicJwk, privateKey };
        return;
      } catch (e) {
        // ADR-044: DPAPI blobs only open on the PC that made them. Lab PCs must be prepared again.
        this.d.logger.warn(
          { keyId: row.keyId, err: (e as Error).message },
          'hub signing key cannot be opened on this PC; making a new one',
        );
        this.d.repo.retire(row.keyId, this.d.clock.now());
      }
    }
    await this.create();
  }

  private async create(): Promise<void> {
    const { publicKey, privateKey } = await generate('rsa', {
      modulusLength: this.d.modulusLength ?? 3072,
    });
    const jwk = publicKey.export({ format: 'jwk' });
    const publicJwk: PublicJwk = { n: jwk.n!, e: jwk.e! };
    const der = privateKey.export({ format: 'der', type: 'pkcs8' });
    const keyId = jwkThumbprint(publicJwk);
    this.d.repo.insert({
      keyId,
      publicJwk,
      privateBlob: await this.d.protector.protect(der),
      createdAt: this.d.clock.now(),
    });
    this.loaded = { keyId, publicJwk, privateKey };
    this.d.logger.info({ keyId }, 'hub signing key created');
  }

  private key(): Loaded {
    if (!this.loaded) throw new Error('hub signing key not loaded (init not called)');
    return this.loaded;
  }

  keyId(): string {
    return this.key().keyId;
  }

  publicKey(): PublicJwk {
    return { ...this.key().publicJwk };
  }

  /** Base64 RSASSA-PKCS1-v1_5/SHA-256 signature over the nonce and the exact body bytes. */
  sign(nonce: string, body: Buffer): string {
    return sign('sha256', signedBytes(nonce, body), this.key().privateKey).toString('base64');
  }
}
