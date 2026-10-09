/**
 * Team secrets at rest (ADR-037). On Windows, DPAPI with LocalMachine scope through PowerShell: the
 * service runs as LocalSystem, and a blob only opens on the PC that made it. The bytes travel on
 * stdin, never on the command line. Elsewhere (Linux CI, development on another OS) an obviously
 * marked development protector is used and the hub logs a warning.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { win32 } from 'node:path';
import type { ProcessRunner, SecretProtector } from '../application/ports';

const ENTROPY = 'UniWake team secrets v1';

const SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$in = [Console]::In.ReadToEnd().Trim().Split(" ")',
  `$entropy = [Text.Encoding]::UTF8.GetBytes("${ENTROPY}")`,
  '$bytes = [Convert]::FromBase64String($in[1])',
  '$scope = [Security.Cryptography.DataProtectionScope]::LocalMachine',
  'if ($in[0] -eq "protect") { $out = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope) } ' +
    'else { $out = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope) }',
  '[Console]::Out.Write([Convert]::ToBase64String($out))',
].join('; ');
const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

export class DpapiSecretProtector implements SecretProtector {
  private readonly exe: string;

  constructor(
    private readonly runner: ProcessRunner,
    systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
  ) {
    this.exe = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  }

  private async call(mode: 'protect' | 'unprotect', data: Buffer): Promise<Buffer> {
    const r = await this.runner.run(
      this.exe,
      // -EncodedCommand: immune to Windows command-line quoting (double quotes would be stripped).
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED],
      { stdin: `${mode} ${data.toString('base64')}`, timeoutMs: 30_000 },
    );
    if (r.exitCode !== 0) {
      // stderr carries PowerShell's error text only (the data went in on stdin).
      const why = [...r.stderr.matchAll(/<S S="Error">([^<]*)<\/S>/g)]
        .map((m) => m[1]!.replace(/_x000D__x000A_/g, ' '))
        .join('')
        .trim()
        .slice(0, 300);
      throw new Error(`DPAPI ${mode} failed (exit ${r.exitCode}): ${why}`);
    }
    return Buffer.from(r.stdout.trim(), 'base64');
  }

  protect(plain: Buffer): Promise<Buffer> {
    return this.call('protect', plain);
  }

  unprotect(blob: Buffer): Promise<Buffer> {
    return this.call('unprotect', blob);
  }
}

const DEV_PREFIX = Buffer.from('UWDEV1');

/**
 * Not secret against anyone who can read the source: it keeps plaintext out of the database file on
 * machines without DPAPI. Never wired on Windows.
 */
export class DevSecretProtector implements SecretProtector {
  private readonly key = createHash('sha256').update(`${ENTROPY} development only`).digest();

  protect(plain: Buffer): Promise<Buffer> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain), c.final()]);
    return Promise.resolve(Buffer.concat([DEV_PREFIX, iv, c.getAuthTag(), body]));
  }

  unprotect(blob: Buffer): Promise<Buffer> {
    if (!blob.subarray(0, DEV_PREFIX.length).equals(DEV_PREFIX)) {
      return Promise.reject(new Error('not a development-protected blob'));
    }
    const iv = blob.subarray(6, 18);
    const tag = blob.subarray(18, 34);
    const d = createDecipheriv('aes-256-gcm', this.key, iv);
    d.setAuthTag(tag);
    return Promise.resolve(Buffer.concat([d.update(blob.subarray(34)), d.final()]));
  }
}
