/**
 * Password hashing with the built-in argon2id (ADR-018): m=19456 KiB, t=2, p=1, 16-byte salt,
 * 32-byte tag, stored as a PHC string.
 */
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Argon2Params {
  memory: number;
  passes: number;
  parallelism: number;
}

export const ARGON2_PARAMS: Argon2Params = { memory: 19456, passes: 2, parallelism: 1 };
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, p: Argon2Params): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password, 'utf8'),
        nonce: salt,
        parallelism: p.parallelism,
        tagLength: TAG_LENGTH,
        memory: p.memory,
        passes: p.passes,
      },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string, params = ARGON2_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, params);
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(hash)}`;
}

interface ParsedPhc {
  params: Argon2Params;
  salt: Buffer;
  hash: Buffer;
}

export function parsePhc(phc: string): ParsedPhc | null {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
    phc,
  );
  if (!m) return null;
  return {
    params: { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]) },
    salt: Buffer.from(m[4]!, 'base64'),
    hash: Buffer.from(m[5]!, 'base64'),
  };
}

export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const parsed = parsePhc(phc);
  if (!parsed) return false;
  const candidate = await derive(password, parsed.salt, parsed.params);
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

/** True when the stored hash uses older parameters and should be re-hashed on next login. */
export function needsRehash(phc: string, params = ARGON2_PARAMS): boolean {
  const parsed = parsePhc(phc);
  if (!parsed) return true;
  return (
    parsed.params.memory !== params.memory ||
    parsed.params.passes !== params.passes ||
    parsed.params.parallelism !== params.parallelism
  );
}
