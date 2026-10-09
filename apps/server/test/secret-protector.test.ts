import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NodeProcessRunner } from '../src/adapters/process-runner';
import { DevSecretProtector, DpapiSecretProtector } from '../src/adapters/secret-protector';
import { FakeProcessRunner } from './fakes/system-fakes';

describe('secret protector (ADR-037)', () => {
  it('development protector round-trips and keeps the plaintext out of the blob', async () => {
    const p = new DevSecretProtector();
    const secret = randomBytes(32);
    const blob = await p.protect(secret);
    expect(blob.includes(secret)).toBe(false);
    expect((await p.unprotect(blob)).equals(secret)).toBe(true);
    await expect(p.unprotect(Buffer.from('garbage'))).rejects.toThrow();
  });

  it('DPAPI adapter passes the bytes on stdin, never on the command line', async () => {
    const runner = new FakeProcessRunner();
    runner.on('powershell.exe', {
      exitCode: 0,
      stdout: Buffer.from('blob').toString('base64'),
      stderr: '',
    });
    const p = new DpapiSecretProtector(runner, 'C:\\Windows');
    const secret = Buffer.from('chave-de-teste-aaaaaaaa');
    expect((await p.protect(secret)).toString()).toBe('blob');
    const call = runner.calls[0]!;
    expect(call.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(call.args.join(' ')).not.toContain(secret.toString('base64'));
    expect(call.opts?.stdin).toBe(`protect ${secret.toString('base64')}`);
    const script = Buffer.from(call.args.at(-1)!, 'base64').toString('utf16le');
    expect(script).toContain('DataProtectionScope]::LocalMachine');
  });

  it('DPAPI adapter reports a failed call', async () => {
    const runner = new FakeProcessRunner();
    runner.on('powershell.exe', { exitCode: 1, stdout: '', stderr: 'boom' });
    await expect(new DpapiSecretProtector(runner).unprotect(Buffer.from('x'))).rejects.toThrow(
      'DPAPI unprotect failed',
    );
  });

  it.runIf(process.platform === 'win32')(
    'AC-201-04: real DPAPI (LocalMachine) round-trips on Windows and the blob hides the key',
    async () => {
      const p = new DpapiSecretProtector(new NodeProcessRunner());
      const secret = randomBytes(32);
      const blob = await p.protect(secret);
      expect(blob.length).toBeGreaterThan(secret.length);
      expect(blob.includes(secret)).toBe(false);
      expect((await p.unprotect(blob)).equals(secret)).toBe(true);
    },
    60_000,
  );
});
