/**
 * Clock check (FR-012): the `Date` header of the update source (ADR-025: api.github.com), so no
 * extra host is contacted. Seconds precision is plenty for a 2-minute warning.
 */
import { request } from 'node:https';
import type { TimeCheck } from '../application/health/health-service';

export class GitHubTimeCheck implements TimeCheck {
  constructor(private readonly host = 'api.github.com') {}

  remoteNow(): Promise<number | null> {
    return new Promise((resolve) => {
      const req = request(
        { host: this.host, path: '/', method: 'HEAD', headers: { 'user-agent': 'UniWake' } },
        (res) => {
          const date = res.headers.date ? Date.parse(res.headers.date) : NaN;
          res.resume();
          resolve(Number.isNaN(date) ? null : date);
        },
      );
      req.on('error', () => resolve(null));
      req.setTimeout(10_000, () => req.destroy());
      req.end();
    });
  }
}
