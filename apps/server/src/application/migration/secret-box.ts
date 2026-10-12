/**
 * Secrets of a `.uniwake` file (ADR-050): key from argon2id(password, per-file salt), AES-256-GCM
 * with the document checksum as additional data, so the secret part cannot be moved to another
 * file. A wrong password and changed bytes give the same error. One key derivation at a time
 * (64 MiB each, D11-02).
 */
import { argon2, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SealedSecrets } from './document';

export interface KdfParams {
  memory: number;
  passes: number;
  parallelism: number;
}

/** Stronger than login hashing: a stolen file can be attacked offline (ADR-050). */
export const EXPORT_KDF: KdfParams = { memory: 65_536, passes: 3, parallelism: 1 };

export class SecretBoxError extends Error {
  constructor() {
    super('Senha incorreta ou arquivo alterado.');
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs derivations one after another, whatever asks for them. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function deriveKey(password: string, salt: Buffer, p: KdfParams): Promise<Buffer> {
  return serialized(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        argon2(
          'argon2id',
          {
            message: Buffer.from(password, 'utf8'),
            nonce: salt,
            parallelism: p.parallelism,
            tagLength: 32,
            memory: p.memory,
            passes: p.passes,
          },
          (err, key) => (err ? reject(err) : resolve(key)),
        );
      }),
  );
}

export async function seal(
  plaintext: Buffer,
  password: string,
  aad: string,
  params: KdfParams = EXPORT_KDF,
): Promise<SealedSecrets> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, params);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    kdf: { alg: 'argon2id', ...params, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export async function open(sealed: SealedSecrets, password: string, aad: string): Promise<Buffer> {
  const salt = Buffer.from(sealed.kdf.salt, 'base64');
  const iv = Buffer.from(sealed.iv, 'base64');
  const tag = Buffer.from(sealed.tag, 'base64');
  if (salt.length < 16 || iv.length !== 12 || tag.length !== 16) throw new SecretBoxError();
  const key = await deriveKey(password, salt, sealed.kdf);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]);
  } catch {
    throw new SecretBoxError();
  }
}
