import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  G,
  hashToGroup,
  isValidElement,
  M,
  modPow,
  N,
  P,
  passwordScalar,
  Q,
  spake2,
} from '../src/application/team/spake2';

const ids = { idA: 'inviter-instance', idB: 'joiner-instance' };
const ctx = Buffer.from('UniWake pairing v1|nonceA|nonceB');

describe('SPAKE2 group (ADR-036)', () => {
  it('uses the RFC 3526 2048-bit safe prime and a generator of the order-q subgroup', () => {
    expect(P.toString(16).length).toBe(512);
    expect(P.toString(16).startsWith('ffffffffffffffffc90fdaa2')).toBe(true); // RFC 3526 §3
    expect(P % 8n).toBe(7n);
    expect(modPow(G, Q, P)).toBe(1n);
    expect(modPow(2n, Q, P)).toBe(1n); // 2 is a quadratic residue (p ≡ 7 mod 8)
  });

  it('M and N are distinct valid subgroup elements derived from fixed labels', () => {
    expect(M).not.toBe(N);
    expect(isValidElement(M)).toBe(true);
    expect(isValidElement(N)).toBe(true);
    expect(hashToGroup('UniWake SPAKE2 v1 M')).toBe(M); // deterministic
  });

  it('rejects elements outside the range or the subgroup', () => {
    expect(isValidElement(0n)).toBe(false);
    expect(isValidElement(1n)).toBe(false);
    expect(isValidElement(P - 1n)).toBe(false); // order 2
    expect(isValidElement(P)).toBe(false);
    // A non-residue (generator of the full group) is not in the order-q subgroup.
    let nonResidue = 3n;
    while (modPow(nonResidue, Q, P) === 1n) nonResidue++;
    expect(isValidElement(nonResidue)).toBe(false);
  });

  it('the password scalar depends on the code and the session context', () => {
    expect(passwordScalar('123456', ctx)).toBe(passwordScalar('123456', ctx));
    expect(passwordScalar('123456', ctx)).not.toBe(passwordScalar('123457', ctx));
    expect(passwordScalar('123456', ctx)).not.toBe(passwordScalar('123456', Buffer.from('x')));
  });
});

describe('SPAKE2 exchange', () => {
  it('both sides derive the same key and accept each other with the right code', () => {
    const a = spake2('A', '482913', ids, ctx);
    const b = spake2('B', '482913', ids, ctx);
    const ka = a.finish(b.message);
    const kb = b.finish(a.message);
    expect(ka.key.equals(kb.key)).toBe(true);
    expect(ka.key).toHaveLength(32);
    expect(ka.verifyPeer(kb.confirm)).toBe(true);
    expect(kb.verifyPeer(ka.confirm)).toBe(true);
    // The code never appears in what is sent.
    for (const sent of [a.message, b.message, ka.confirm, kb.confirm]) {
      expect(sent.includes(Buffer.from('482913'))).toBe(false);
    }
  });

  it('any other code fails key confirmation on both sides', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_999 }), (n) => {
        const guess = String(n).padStart(6, '0');
        fc.pre(guess !== '482913');
        const a = spake2('A', '482913', ids, ctx);
        const b = spake2('B', guess, ids, ctx);
        const ka = a.finish(b.message);
        const kb = b.finish(a.message);
        return !ka.verifyPeer(kb.confirm) && !kb.verifyPeer(ka.confirm) && !ka.key.equals(kb.key);
      }),
      { numRuns: 8 },
    );
  });

  it('different identities or contexts do not agree', () => {
    const a = spake2('A', '000001', ids, ctx);
    const b = spake2('B', '000001', { idA: 'someone-else', idB: ids.idB }, ctx);
    expect(a.finish(b.message).verifyPeer(b.finish(a.message).confirm)).toBe(false);
  });

  it('a malformed or out-of-group peer message is refused', () => {
    const a = spake2('A', '123456', ids, ctx);
    expect(() => a.finish(Buffer.alloc(10))).toThrow('length');
    const bad = Buffer.from((P - 1n).toString(16).padStart(512, '0'), 'hex');
    expect(() => a.finish(bad)).toThrow('invalid element');
  });
});
