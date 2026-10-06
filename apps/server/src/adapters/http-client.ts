/**
 * Outbound HTTP for updates (NFR-05, ADR-025): only allowlisted hosts, HTTPS except for a local
 * test release server, redirects followed by hand so every hop is checked, bounded time and size,
 * and downloads that never leave a partial file behind.
 */
import { createWriteStream, renameSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

type FetchFn = typeof fetch;

export class HostNotAllowedError extends Error {
  constructor(url: string) {
    super(`host not allowed for updates: ${url}`);
    this.name = 'HostNotAllowedError';
  }
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'HttpStatusError';
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class AllowlistHttpClient {
  constructor(
    private readonly hosts: readonly string[],
    private readonly fetchImpl: FetchFn = fetch,
    private readonly userAgent = 'UniWake',
  ) {}

  /** Throws unless `url` is https (or http to loopback) on an allowlisted host. */
  check(url: string): URL {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new HostNotAllowedError(url);
    }
    const loopback = LOOPBACK.has(u.hostname);
    const schemeOk = u.protocol === 'https:' || (u.protocol === 'http:' && loopback);
    if (!schemeOk || !this.hosts.includes(u.host) || u.username || u.password) {
      throw new HostNotAllowedError(url);
    }
    return u;
  }

  private async request(url: string, timeoutMs: number, accept: string): Promise<Response> {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      this.check(current);
      const res = await this.fetchImpl(current, {
        redirect: 'manual',
        headers: { 'user-agent': this.userAgent, accept },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel();
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }
      return res;
    }
    throw new Error(`too many redirects from ${url}`);
  }

  async getJson<T>(
    url: string,
    timeoutMs = 20_000,
  ): Promise<{ status: number; date: number | null; body: T | null }> {
    const res = await this.request(url, timeoutMs, 'application/vnd.github+json');
    const dateHeader = res.headers.get('date');
    const date = dateHeader ? Date.parse(dateHeader) : NaN;
    const body = res.ok ? ((await res.json()) as T) : (await res.body?.cancel(), null);
    return { status: res.status, date: Number.isNaN(date) ? null : date, body };
  }

  /** Streams `url` to `dest` (via `dest.part`); at most `maxBytes`. */
  async download(url: string, dest: string, maxBytes: number, timeoutMs = 600_000) {
    const res = await this.request(url, timeoutMs, 'application/octet-stream');
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new HttpStatusError(res.status, url);
    }
    const declared = Number(res.headers.get('content-length') ?? NaN);
    if (declared > maxBytes) {
      await res.body.cancel();
      throw new Error(`download larger than ${maxBytes} bytes: ${url}`);
    }
    const part = `${dest}.part`;
    let received = 0;
    try {
      const source = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
      source.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes)
          source.destroy(new Error(`download larger than ${maxBytes} bytes`));
      });
      await pipeline(source, createWriteStream(part));
      renameSync(part, dest);
    } catch (e) {
      rmSync(part, { force: true });
      throw e;
    }
    return received;
  }
}
