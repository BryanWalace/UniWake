/**
 * Where updates come from (ADR-025): compiled into the build, never configurable at run time, so
 * nobody with admin or database access can redirect the hub to run another installer as SYSTEM.
 * Only test builds (`scripts/build.ts --test-update-api`) point at a fake release server.
 */
declare const __UPDATE_API__: string | undefined;

export const UPDATE_REPO = 'BryanWalace/UniWake';

export const UPDATE_API: string =
  typeof __UPDATE_API__ === 'string' ? __UPDATE_API__ : 'https://api.github.com';

/** Hosts the update client may contact: the API and GitHub's release download hosts. */
export function updateHosts(api = UPDATE_API): string[] {
  const apiHost = new URL(api).host;
  return apiHost === 'api.github.com'
    ? [
        'api.github.com',
        'github.com',
        'objects.githubusercontent.com',
        'release-assets.githubusercontent.com',
      ]
    : [apiHost];
}
