/**
 * `port-probe-node` (27.7; CAP-35): the real `PortProbePort`. A port is
 * free when a server can listen on it on `127.0.0.1` (never `0.0.0.0`,
 * `::` or a hostname), exclusively; it is closed at once. In use
 * (`EADDRINUSE`), refused (`EACCES`: Windows' reserved ranges), any other
 * error, a port out of range, or no answer within the timeout: not free.
 *
 * On macOS a port another program holds on the wildcard address can still
 * be bound on `127.0.0.1`, so it may read free; that program's port is then
 * the copy's, and the next copy gets another.
 */
import { createServer } from 'node:net';
import type { PortProbePort } from '@ogden-agents/core';

/** The only address probed. */
export const PORT_PROBE_HOST = '127.0.0.1';
/** How long a probe waits for the listen to answer. */
const PROBE_TIMEOUT_MS = 1_000;

export interface PortProbeNodeOptions {
  /** Default 1 s. */
  timeoutMs?: number;
}

export function createPortProbeNode(options: PortProbeNodeOptions = {}): PortProbePort {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  return {
    isFree(port) {
      if (!Number.isInteger(port) || port < 1 || port > 65_535) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const server = createServer();
        let settled = false;
        const settle = (free: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (server.listening) server.close(() => resolve(free));
          else resolve(free);
        };
        const timer = setTimeout(() => settle(false), timeoutMs);
        timer.unref?.();
        server.on('error', () => settle(false));
        try {
          server.listen({ host: PORT_PROBE_HOST, port, exclusive: true }, () => {
            // Listening only after the timeout gave up: closed at once all the same.
            if (settled) server.close();
            else settle(true);
          });
        } catch {
          settle(false);
        }
        server.unref();
      });
    },
  };
}
