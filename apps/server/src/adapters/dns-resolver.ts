/** Hostname resolution with a timeout (plan §10: DNS 2 s). Uses the OS resolver (lookup). */
import dns from 'node:dns';
import type { DnsResolver } from '../application/ports';

export class OsDnsResolver implements DnsResolver {
  constructor(private readonly timeoutMs = 2000) {}

  resolve4(hostname: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`DNS timeout for ${hostname}`)),
        this.timeoutMs,
      );
      // lookup() uses the OS resolver, so NetBIOS/LLMNR names on a Windows network also resolve.
      dns.lookup(hostname, { family: 4, all: true }, (err, addresses) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(addresses.map((a) => a.address));
      });
    });
  }
}
