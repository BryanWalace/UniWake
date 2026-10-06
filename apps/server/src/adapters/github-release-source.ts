/**
 * The latest GitHub release of the compiled-in repository (FR-001.2, ADR-025), through the
 * allowlisted HTTP client.
 */
import type { ReleaseInfo, ReleaseSource } from '../application/ports';
import type { AllowlistHttpClient } from './http-client';
import { HttpStatusError } from './http-client';

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/** Largest installer the hub will download (ADR-022: ≈ 40 MB). */
export const MAX_INSTALLER_BYTES = 200 * 1024 * 1024;

export class GitHubReleaseSource implements ReleaseSource {
  constructor(
    private readonly http: AllowlistHttpClient,
    private readonly api: string,
    private readonly repo: string,
  ) {}

  async latest(): Promise<{ release: ReleaseInfo | null; serverDate: number | null }> {
    const url = `${this.api}/repos/${this.repo}/releases/latest`;
    const r = await this.http.getJson<GitHubRelease>(url);
    if (r.status === 404) return { release: null, serverDate: r.date }; // no release yet
    if (!r.body) throw new HttpStatusError(r.status, url); // 403/429 = rate limited
    const g = r.body;
    return {
      serverDate: r.date,
      release: {
        tag: g.tag_name,
        version: g.tag_name.replace(/^v/, ''),
        name: g.name ?? g.tag_name,
        body: g.body ?? '',
        draft: g.draft,
        prerelease: g.prerelease,
        publishedAt: g.published_at ?? '',
        assets: g.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
      },
    };
  }

  async download(url: string, dest: string): Promise<void> {
    await this.http.download(url, dest, MAX_INSTALLER_BYTES);
  }
}
