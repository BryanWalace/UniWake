/**
 * Child processes (plan §9.1): argument arrays only, never a shell, always a timeout, hidden
 * windows. The only adapter allowed to start processes.
 */
import { spawn } from 'node:child_process';
import type { ProcessResult, ProcessRunner, RunOptions } from '../application/ports';

export class ProcessTimeoutError extends Error {
  constructor(file: string, ms: number) {
    super(`${file} did not finish within ${ms} ms`);
    this.name = 'ProcessTimeoutError';
  }
}

const MAX_OUTPUT = 8 * 1024 * 1024;

export class NodeProcessRunner implements ProcessRunner {
  run(file: string, args: readonly string[], opts: RunOptions = {}): Promise<ProcessResult> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const child = spawn(file, [...args], {
        shell: false,
        windowsHide: true,
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let size = 0;
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        child.kill();
        done(() => reject(new ProcessTimeoutError(file, timeoutMs)));
      }, timeoutMs);
      const collect = (target: 'out' | 'err') => (d: Buffer) => {
        size += d.length;
        if (size > MAX_OUTPUT) {
          child.kill();
          done(() => reject(new Error(`${file} produced more than ${MAX_OUTPUT} bytes`)));
          return;
        }
        if (target === 'out') stdout += d.toString('utf8');
        else stderr += d.toString('utf8');
      };
      child.stdout.on('data', collect('out'));
      child.stderr.on('data', collect('err'));
      child.on('error', (e) => done(() => reject(e)));
      child.on('close', (code) => done(() => resolve({ exitCode: code ?? -1, stdout, stderr })));
      if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
      else child.stdin.end();
    });
  }
}
