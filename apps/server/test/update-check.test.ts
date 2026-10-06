import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@uniwake/shared';
import { GitHubReleaseSource } from '../src/adapters/github-release-source';
import { AllowlistHttpClient, HostNotAllowedError } from '../src/adapters/http-client';
import type { ReleaseInfo, ReleaseSource } from '../src/application/ports';
import { CHECK_FAILED, UpdateService } from '../src/application/update/update-service';
import { compareSemver, parseSemver } from '../src/domain/semver';
import { SqliteUpdateStateStore } from '../src/db/repositories/update-state-repo';
import { SettingsService } from '../src/application/settings/settings-service';
import { SqliteSettingsRepo } from '../src/db/repositories/settings-repo';
import { updateHosts } from '../src/update-source';
import { FakeClock } from './fakes/fake-clock';
import { MemoryLogger } from './fakes/system-fakes';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0, testDb } from './helpers/db';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('SemVer (FR-001.2)', () => {
  it('parses tags with or without "v" and refuses non-SemVer tags', () => {
    expect(parseSemver('v1.10.2')).toEqual({ major: 1, minor: 10, patch: 2, prerelease: [] });
    expect(parseSemver('1.0.0-rc.1+build.5')?.prerelease).toEqual(['rc', 1]);
    for (const bad of ['1.0', 'v01.0.0', 'latest', '1.0.0.0', 'v1.0.0-']) {
      expect(parseSemver(bad), bad).toBeNull();
    }
  });

  it('orders versions as SemVer §11 says', () => {
    const order = [
      '0.0.0-dev',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-beta',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.2.0',
      '1.10.0',
      '2.0.0',
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        compareSemver(parseSemver(order[i - 1]!)!, parseSemver(order[i]!)!),
        order[i],
      ).toBeLessThan(0);
    }
    expect(compareSemver(parseSemver('1.0.0+a')!, parseSemver('1.0.0+b')!)).toBe(0);
  });
});

/** In-memory HTTP: no network in tests (constitution §5). */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = ((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push(url);
    const r = routes[url];
    return Promise.resolve(r ? r() : new Response('not found', { status: 404 }));
  }) as typeof fetch;
  return { fn, calls };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'uniwake-upd-'));
  dirs.push(d);
  return d;
};

describe('allowlisted HTTP client (NFR-05, ADR-025)', () => {
  const hosts = updateHosts('https://api.github.com');

  it('allows only HTTPS to the GitHub release hosts (http only to a loopback test server)', () => {
    const c = new AllowlistHttpClient(hosts, fakeFetch({}).fn);
    expect(() => c.check('https://api.github.com/repos/x')).not.toThrow();
    for (const bad of [
      'http://api.github.com/repos/x',
      'https://evil.example/x',
      'https://api.github.com.evil.example/x',
      'https://user:pw@api.github.com/x',
      'file:///C:/Windows/System32/cmd.exe',
      'not a url',
    ]) {
      expect(() => c.check(bad), bad).toThrow(HostNotAllowedError);
    }
    const local = new AllowlistHttpClient(updateHosts('http://127.0.0.1:8123'), fakeFetch({}).fn);
    expect(() => local.check('http://127.0.0.1:8123/x')).not.toThrow();
    expect(() => local.check('https://api.github.com/x')).toThrow(HostNotAllowedError);
  });

  it('checks every redirect hop and downloads through a partial file', async () => {
    const dest = join(temp(), 'setup.exe');
    const ok = fakeFetch({
      'https://github.com/a/setup.exe': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://objects.githubusercontent.com/x/setup.exe' },
        }),
      'https://objects.githubusercontent.com/x/setup.exe': () => new Response('MZ installer'),
    });
    const c = new AllowlistHttpClient(hosts, ok.fn);
    expect(await c.download('https://github.com/a/setup.exe', dest, 1000)).toBe(12);
    expect(readFileSync(dest, 'utf8')).toBe('MZ installer');

    const evil = fakeFetch({
      'https://github.com/a/setup.exe': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/setup.exe' },
        }),
    });
    const dest2 = join(temp(), 'setup.exe');
    await expect(
      new AllowlistHttpClient(hosts, evil.fn).download(
        'https://github.com/a/setup.exe',
        dest2,
        1000,
      ),
    ).rejects.toThrow(HostNotAllowedError);
    expect(evil.calls).toEqual(['https://github.com/a/setup.exe']);
    expect(existsSync(dest2)).toBe(false);
  });

  it('stops a download that grows past its limit and leaves nothing behind', async () => {
    const dest = join(temp(), 'setup.exe');
    const big = fakeFetch({
      'https://github.com/a/setup.exe': () => new Response('x'.repeat(5000)),
    });
    await expect(
      new AllowlistHttpClient(hosts, big.fn).download('https://github.com/a/setup.exe', dest, 1000),
    ).rejects.toThrow(/larger than 1000/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });
});

const GH_RELEASE = {
  tag_name: 'v1.1.0',
  name: 'UniWake 1.1.0',
  body: '- Nova página de ajuda',
  draft: false,
  prerelease: false,
  published_at: '2026-10-01T12:00:00Z',
  assets: [
    {
      name: 'UniWake-Setup.exe',
      browser_download_url: 'https://github.com/r/UniWake-Setup.exe',
      size: 40_000_000,
    },
    {
      name: 'UniWake-Setup.exe.sha256',
      browser_download_url: 'https://github.com/r/UniWake-Setup.exe.sha256',
      size: 90,
    },
  ],
};

describe('GitHub release source (FR-001.2)', () => {
  const api = 'https://api.github.com';
  const url = `${api}/repos/BryanWalace/UniWake/releases/latest`;

  it('maps the latest release and reads the server date', async () => {
    const f = fakeFetch({
      [url]: () =>
        Response.json(GH_RELEASE, { headers: { date: 'Mon, 05 Oct 2026 12:00:00 GMT' } }),
    });
    const src = new GitHubReleaseSource(
      new AllowlistHttpClient(updateHosts(api), f.fn),
      api,
      'BryanWalace/UniWake',
    );
    const r = await src.latest();
    expect(r.serverDate).toBe(Date.UTC(2026, 9, 5, 12));
    expect(r.release).toMatchObject({
      tag: 'v1.1.0',
      version: '1.1.0',
      body: '- Nova página de ajuda',
      assets: [
        { name: 'UniWake-Setup.exe', size: 40_000_000 },
        { name: 'UniWake-Setup.exe.sha256' },
      ],
    });
  });

  it('no release yet is null; a rate limit is an error', async () => {
    const none = new GitHubReleaseSource(
      new AllowlistHttpClient(updateHosts(api), fakeFetch({}).fn),
      api,
      'BryanWalace/UniWake',
    );
    expect((await none.latest()).release).toBeNull();
    const limited = new GitHubReleaseSource(
      new AllowlistHttpClient(
        updateHosts(api),
        fakeFetch({ [url]: () => new Response('{}', { status: 403 }) }).fn,
      ),
      api,
      'BryanWalace/UniWake',
    );
    await expect(limited.latest()).rejects.toThrow(/HTTP 403/);
  });
});

function release(over: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    tag: 'v1.1.0',
    version: '1.1.0',
    name: 'UniWake 1.1.0',
    body: '- Nova página de ajuda',
    draft: false,
    prerelease: false,
    publishedAt: '2026-10-01T12:00:00Z',
    assets: [
      { name: 'UniWake-Setup.exe', url: 'https://github.com/r/setup.exe', size: 40_000_000 },
      { name: 'UniWake-Setup.exe.sha256', url: 'https://github.com/r/setup.exe.sha256', size: 90 },
    ],
    ...over,
  };
}

class FakeSource implements ReleaseSource {
  next: ReleaseInfo | null | Error = release();
  calls = 0;
  latest() {
    this.calls++;
    if (this.next instanceof Error) return Promise.reject(this.next);
    return Promise.resolve({ release: this.next, serverDate: null });
  }
  download(): Promise<void> {
    return Promise.reject(new Error('not used'));
  }
}

function updateService(version = '1.0.0', db = testDb(), clock = new FakeClock(T0)) {
  const source = new FakeSource();
  const settings = new SettingsService(new SqliteSettingsRepo(db), clock);
  const make = () =>
    new UpdateService({
      source,
      version,
      store: new SqliteUpdateStateStore(db),
      settings,
      clock,
      logger: new MemoryLogger(),
    });
  return { source, clock, settings, service: make(), make, db };
}

describe('update check (FR-001.2)', () => {
  it('AC-001-04: running 1.0.0 with v1.1.0 published, a newer version is offered with its notes', async () => {
    const { service } = updateService();
    const s = await service.check();
    expect(s).toMatchObject({
      current: '1.0.0',
      enabled: true,
      available: true,
      latest: { version: '1.1.0', notes: '- Nova página de ajuda' },
      lastSuccessAt: T0,
      error: null,
    });
    expect(service.pending()?.installer).toEqual({
      url: 'https://github.com/r/setup.exe',
      size: 40_000_000,
    });
  });

  it('AC-001-05: prereleases, drafts, non-SemVer tags and versions not newer are never offered', async () => {
    const { service, source } = updateService('1.1.0');
    for (const r of [
      release({ prerelease: true, tag: 'v1.2.0-rc.1', version: '1.2.0-rc.1' }),
      release({ draft: true, tag: 'v1.2.0', version: '1.2.0' }),
      release({ tag: 'nightly', version: 'nightly' }),
      release({ tag: 'v1.1.0', version: '1.1.0' }),
      release({ tag: 'v1.0.9', version: '1.0.9' }),
    ]) {
      source.next = r;
      expect((await service.check()).available, r.tag).toBe(false);
    }
    // Newer but without the installer or its checksum: not installable.
    source.next = release({ tag: 'v1.2.0', version: '1.2.0', assets: [] });
    expect((await service.check()).available).toBe(false);
  });

  it('AC-001-06: an unreachable or rate-limited GitHub keeps the last good result and says so', async () => {
    const { service, source, clock } = updateService();
    await service.check();
    clock.advance(6 * HOUR);
    source.next = new Error('HTTP 403');
    const s = await service.check();
    expect(s).toMatchObject({
      error: CHECK_FAILED,
      lastSuccessAt: T0,
      lastCheckAt: T0 + 6 * HOUR,
      available: true,
    });
    expect(CHECK_FAILED).toBe('Não foi possível verificar atualizações.');
  });

  it('checks 2 minutes after start and then every update.checkIntervalHours, even after failures', async () => {
    const { service, source, clock, settings } = updateService();
    settings.update({ 'update.checkIntervalHours': 6 }, null);
    service.start();
    expect(service.status().nextCheckAt).toBe(T0 + 2 * MIN);
    await clock.advanceAsync(2 * MIN - 1);
    expect(source.calls).toBe(0);
    source.next = new Error('offline');
    await clock.advanceAsync(1);
    expect(source.calls).toBe(1);
    expect(service.status().nextCheckAt).toBe(T0 + 2 * MIN + 6 * HOUR);
    await clock.advanceAsync(6 * HOUR);
    expect(source.calls).toBe(2);
    service.stop();
  });

  it('the result survives a restart', async () => {
    const { service, make } = updateService();
    await service.check();
    expect(make().status()).toMatchObject({ available: true, lastSuccessAt: T0 });
  });
});

describe('update routes (FR-001.2, FR-006.2)', () => {
  const hs: ApiHarness[] = [];
  afterEach(async () => {
    for (const h of hs.splice(0)) await h.close();
  });

  it('operators read the status; only admins can check now; tests and demo never call out', async () => {
    const source = new FakeSource();
    const h = await apiHarness(undefined, { releaseSource: source, version: '1.0.0' });
    hs.push(h);
    const op = await h.as('operator');
    const admin = await h.as('admin');
    expect((await h.inject({ url: '/api/update', cookie: op })).json<UpdateStatus>()).toMatchObject(
      {
        current: '1.0.0',
        enabled: true,
        available: false,
      },
    );
    expect(
      (await h.inject({ method: 'POST', url: '/api/update/check', cookie: op })).statusCode,
    ).toBe(403);
    const r = await h.inject({ method: 'POST', url: '/api/update/check', cookie: admin });
    expect(r.json<UpdateStatus>()).toMatchObject({ available: true, latest: { version: '1.1.0' } });

    const demo = await apiHarness(undefined, { releaseSource: source, demo: true });
    hs.push(demo);
    const calls = source.calls;
    await demo.inject({ method: 'POST', url: '/api/update/check', cookie: await demo.as('admin') });
    expect(source.calls).toBe(calls);
    expect(demo.services.update.status().enabled).toBe(false);
  });
});
