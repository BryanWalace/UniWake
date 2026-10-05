/**
 * Panel certificate for LAN HTTPS (ADR-012, ADR-026): `<dataDir>/certs/panel.pfx` with its random
 * password in `pfx.key`. Created on first use by `helper/new-panel-cert.ps1` on Windows, or
 * replaced by an admin-uploaded PFX. Every PFX is checked by building a TLS context from it.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { createSecureContext } from 'node:tls';
import type { ProcessRunner } from '../application/ports';

export interface PanelCertificate {
  pfx: Buffer;
  passphrase: string;
}

export class CertificateError extends Error {
  override name = 'CertificateError';
}

/** Throws a CertificateError (pt-BR) when the PFX or its password is not usable. */
export function checkPfx(pfx: Buffer, passphrase: string): void {
  try {
    createSecureContext({ pfx, passphrase });
  } catch {
    throw new CertificateError('Certificado inválido ou senha incorreta.');
  }
}

export class PanelCertificateStore {
  private readonly pfxPath: string;
  private readonly keyPath: string;

  constructor(
    private readonly certsDir: string,
    private readonly runner: ProcessRunner,
    private readonly scriptPath: string | null,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
  ) {
    this.pfxPath = join(certsDir, 'panel.pfx');
    this.keyPath = join(certsDir, 'pfx.key');
  }

  private read(): PanelCertificate | null {
    if (!existsSync(this.pfxPath) || !existsSync(this.keyPath)) return null;
    const cert = {
      pfx: readFileSync(this.pfxPath),
      passphrase: readFileSync(this.keyPath, 'utf8').trim(),
    };
    checkPfx(cert.pfx, cert.passphrase);
    return cert;
  }

  /** The stored certificate, generating a self-signed one for `lanAddress` if there is none. */
  async loadOrCreate(lanAddress: string): Promise<PanelCertificate> {
    const existing = this.read();
    if (existing) return existing;
    if (this.platform !== 'win32' || !this.scriptPath) {
      throw new CertificateError(
        'Nenhum certificado para o acesso pela rede: envie um arquivo PFX em Configurações.',
      );
    }
    mkdirSync(this.certsDir, { recursive: true });
    const passphrase = randomBytes(24).toString('base64url');
    const tmp = `${this.pfxPath}.new`;
    const r = await this.runner.run(
      win32.join(this.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.scriptPath,
        '-Address',
        lanAddress,
        '-OutFile',
        tmp,
      ],
      { stdin: `${passphrase}\n`, timeoutMs: 60_000 },
    );
    if (r.exitCode !== 0 || !existsSync(tmp)) {
      rmSync(tmp, { force: true });
      throw new CertificateError(
        `Não foi possível gerar o certificado do painel (${r.stderr.trim().slice(0, 200) || `código ${r.exitCode}`}).`,
      );
    }
    this.save(readFileSync(tmp), passphrase);
    rmSync(tmp, { force: true });
    return this.read()!;
  }

  /** Stores an admin-uploaded PFX after checking it (applies after a restart). */
  save(pfx: Buffer, passphrase: string): void {
    checkPfx(pfx, passphrase);
    mkdirSync(this.certsDir, { recursive: true });
    writeFileSync(`${this.pfxPath}.tmp`, pfx);
    writeFileSync(`${this.keyPath}.tmp`, passphrase, 'utf8');
    renameSync(`${this.pfxPath}.tmp`, this.pfxPath);
    renameSync(`${this.keyPath}.tmp`, this.keyPath);
  }
}
