/**
 * Whether something listens on a loopback port (ADR-052: `--import` refuses while the service
 * runs). A plain TCP connect, not fetch: on Windows, exiting right after a fetch can abort Node
 * while its sockets close (release smoke test: a libuv assertion instead of exit code 3).
 */
import { connect } from 'node:net';

export function loopbackPortInUse(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
