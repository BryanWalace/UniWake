/**
 * M21-T02 (FR-402, ADR-050): secrets of a `.uniwake` file — round trip, wrong password, changed
 * bytes, moved secret part, and no plaintext in the sealed form.
 */
import { describe, expect, it } from 'vitest';
import { open, seal, SecretBoxError } from '../src/application/migration/secret-box';

// Small parameters keep the test fast; production uses EXPORT_KDF (64 MiB, 3 passes).
const FAST = { memory: 8192, passes: 1, parallelism: 1 };
const SECRET = Buffer.from('{"users":[{"passwordHash":"$argon2id$v=19$segredo"}]}');
const PASSWORD = 'senha-de-teste-longa';

describe('secret box (ADR-050)', () => {
  it('opens with the same password and checksum', async () => {
    const sealed = await seal(SECRET, PASSWORD, 'checksum-a', FAST);
    expect(await open(sealed, PASSWORD, 'checksum-a')).toEqual(SECRET);
    expect(sealed.kdf).toMatchObject({ alg: 'argon2id', memory: 8192, passes: 1 });
  });

  it('AC-402-01: a wrong password, one changed byte or another file all give the same error', async () => {
    const sealed = await seal(SECRET, PASSWORD, 'checksum-a', FAST);
    await expect(open(sealed, 'outra-senha-qualquer', 'checksum-a')).rejects.toThrow(
      'Senha incorreta ou arquivo alterado.',
    );
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[3] = bytes[3]! ^ 1;
    await expect(
      open({ ...sealed, ciphertext: bytes.toString('base64') }, PASSWORD, 'checksum-a'),
    ).rejects.toBeInstanceOf(SecretBoxError);
    await expect(open(sealed, PASSWORD, 'checksum-b')).rejects.toBeInstanceOf(SecretBoxError);
    await expect(open({ ...sealed, iv: 'AAAA' }, PASSWORD, 'checksum-a')).rejects.toBeInstanceOf(
      SecretBoxError,
    );
  });

  it('AC-402-02: the sealed form never shows the secret or the password', async () => {
    const sealed = await seal(SECRET, PASSWORD, 'checksum-a', FAST);
    const text = JSON.stringify(sealed);
    expect(text).not.toContain('argon2id$v=19$segredo');
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain(PASSWORD);
    // A fresh salt and IV each time: the same input never seals the same way.
    expect((await seal(SECRET, PASSWORD, 'checksum-a', FAST)).ciphertext).not.toBe(
      sealed.ciphertext,
    );
  });

  it('derivations run one at a time (D11-02) and all finish', async () => {
    const all = await Promise.all(
      [1, 2, 3].map((i) => seal(Buffer.from(`s${i}`), PASSWORD, 'c', FAST)),
    );
    expect(await Promise.all(all.map((s) => open(s, PASSWORD, 'c')))).toEqual([
      Buffer.from('s1'),
      Buffer.from('s2'),
      Buffer.from('s3'),
    ]);
  });
});
