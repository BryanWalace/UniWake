/**
 * SPAKE2 (ADR-036): the RFC 9382 protocol — messages, transcript, key schedule and key
 * confirmation — in the prime-order subgroup of the RFC 3526 2048-bit MODP group (safe prime p,
 * q = (p − 1) / 2, generator 4). The 6-digit code authenticates the exchange without being sent:
 * an eavesdropper learns nothing to test guesses against, and each online guess costs an attempt.
 */
import {
  createDiffieHellmanGroup,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** RFC 3526 group 14, read from OpenSSL so the constant cannot be mistyped. */
export const P = BigInt(`0x${createDiffieHellmanGroup('modp14').getPrime('hex')}`);
export const Q = (P - 1n) / 2n;
export const G = 4n;
const ELEMENT_BYTES = 256;

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

const toBytes = (x: bigint, len = ELEMENT_BYTES): Buffer =>
  Buffer.from(x.toString(16).padStart(len * 2, '0'), 'hex');
const fromBytes = (b: Buffer): bigint => BigInt(`0x${b.toString('hex') || '0'}`);

/** SHA-512 in counter mode, `len` bytes. */
function expand(label: string, len: number): Buffer {
  const out: Buffer[] = [];
  for (let i = 0; out.length * 64 < len; i++) {
    out.push(createHash('sha512').update(`${label}\u0000${i}`).digest());
  }
  return Buffer.concat(out).subarray(0, len);
}

/** An element of the order-q subgroup whose discrete log nobody knows (a square of a hash). */
export function hashToGroup(label: string): bigint {
  const h = fromBytes(expand(label, ELEMENT_BYTES + 64)) % P;
  return modPow(h, 2n, P);
}

export const M = hashToGroup('UniWake SPAKE2 v1 M');
export const N = hashToGroup('UniWake SPAKE2 v1 N');

/** Range and subgroup check of a received element (RFC 9382 §7). */
export function isValidElement(e: bigint): boolean {
  return e > 1n && e < P - 1n && modPow(e, Q, P) === 1n;
}

/** w = H(context ‖ code) mod q (ADR-036: the code is single-use and online-guessing limited). */
export function passwordScalar(code: string, context: Buffer): bigint {
  return (
    fromBytes(createHash('sha512').update(context).update('\u0000').update(code, 'utf8').digest()) %
    Q
  );
}

function randomScalar(): bigint {
  for (;;) {
    const x = fromBytes(randomBytes(40)) % Q;
    if (x > 1n) return x;
  }
}

function lenPrefixed(...parts: Buffer[]): Buffer {
  const out: Buffer[] = [];
  for (const p of parts) {
    const len = Buffer.alloc(8);
    len.writeBigUInt64LE(BigInt(p.length));
    out.push(len, p);
  }
  return Buffer.concat(out);
}

export interface Spake2Keys {
  /** Shared secret for the session (RFC 9382 Ke), 32 bytes after HKDF. */
  key: Buffer;
  /** Our key-confirmation MAC, sent to the peer. */
  confirm: Buffer;
  /** Checks the peer's key-confirmation MAC (constant time). */
  verifyPeer(mac: Buffer): boolean;
}

export interface Spake2Party {
  /** pA (role A) or pB (role B), 256 bytes. */
  readonly message: Buffer;
  /** Throws on an invalid peer element; a wrong code yields keys whose confirmation fails. */
  finish(peerMessage: Buffer): Spake2Keys;
}

/**
 * One side of the exchange. `idA`/`idB` are the inviter's and joiner's instance ids; `context`
 * binds the session (protocol label and both nonces).
 */
export function spake2(
  role: 'A' | 'B',
  code: string,
  ids: { idA: string; idB: string },
  context: Buffer,
  scalar: bigint = randomScalar(),
): Spake2Party {
  const w = passwordScalar(code, context);
  const mine = role === 'A' ? M : N;
  const theirs = role === 'A' ? N : M;
  const own = (modPow(G, scalar, P) * modPow(mine, w, P)) % P;
  const message = toBytes(own);
  return {
    message,
    finish(peerMessage) {
      if (peerMessage.length !== ELEMENT_BYTES) throw new Error('SPAKE2: bad element length');
      const peer = fromBytes(peerMessage);
      if (!isValidElement(peer)) throw new Error('SPAKE2: invalid element');
      // K = (peer · theirs^(−w))^scalar; theirs has order q, so theirs^(−w) = theirs^(q − w).
      const unblinded = (peer * modPow(theirs, Q - w, P)) % P;
      const K = modPow(unblinded, scalar, P);
      if (K === 1n) throw new Error('SPAKE2: degenerate key');
      const pA = role === 'A' ? message : peerMessage;
      const pB = role === 'A' ? peerMessage : message;
      const TT = lenPrefixed(
        Buffer.from(ids.idA, 'utf8'),
        Buffer.from(ids.idB, 'utf8'),
        pA,
        pB,
        toBytes(K),
        toBytes(w),
      );
      const digest = createHash('sha256').update(TT).digest();
      const Ke = digest.subarray(0, 16);
      const Ka = digest.subarray(16);
      const kc = Buffer.from(hkdfSync('sha256', Ka, Buffer.alloc(0), 'ConfirmationKeys', 64));
      const kcA = kc.subarray(0, 32);
      const kcB = kc.subarray(32);
      const mac = (k: Buffer) => createHmac('sha256', k).update(TT).digest();
      const ownMac = mac(role === 'A' ? kcA : kcB);
      const peerMac = mac(role === 'A' ? kcB : kcA);
      const key = Buffer.from(hkdfSync('sha256', Ke, context, 'UniWake pairing key', 32));
      return {
        key,
        confirm: ownMac,
        verifyPeer: (m) => m.length === peerMac.length && timingSafeEqual(m, peerMac),
      };
    },
  };
}
