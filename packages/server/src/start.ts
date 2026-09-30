import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createAdaptorServer } from '@hono/node-server';
import { createEventBus, type EventBus } from '@ogdenmad/core';
import openBrowser from 'open';
import { WebSocketServer } from 'ws';
import pkg from '../package.json' with { type: 'json' };
import { createApp } from './app.js';
import { createLogger, type Logger } from './log.js';

/** The only interface the server ever binds (AD-15). */
export const HOST = '127.0.0.1';
/** Fixed default so bookmarks usually keep working; falls back to the next free port. */
export const DEFAULT_PORT = 4317;
/** How many consecutive ports to try before giving up. */
export const PORT_ATTEMPTS = 20;

/** `packages/web/dist`, resolved from both `src/start.ts` and the bundled `dist/index.js`. */
const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface StartOptions {
  /** Port to try first. `0` asks the OS for any free port. Default {@link DEFAULT_PORT}. */
  port?: number;
  /** Open the default browser at the server URL. Default `false`. */
  open?: boolean;
  /** Override the built UI directory. */
  webRoot?: string;
  /** Override the core event bus (tests). */
  bus?: EventBus;
  /** Override the logger (tests). */
  log?: Logger;
}

export interface RunningServer {
  url: string;
  port: number;
  version: string;
  close(): Promise<void>;
}

export async function start(options: StartOptions = {}): Promise<RunningServer> {
  const log = options.log ?? createLogger();
  const bus = options.bus ?? createEventBus();
  const requested = options.port ?? DEFAULT_PORT;
  const app = createApp({ bus, webRoot: options.webRoot ?? DEFAULT_WEB_ROOT, log });

  let bound: { server: ReturnType<typeof createAdaptorServer>; wss: WebSocketServer; port: number } | undefined;
  let lastTried = requested;

  for (let attempt = 0; attempt < PORT_ATTEMPTS && bound === undefined; attempt++) {
    const candidate = requested === 0 ? 0 : requested + attempt;
    if (candidate > 65535) break;
    lastTried = candidate;
    const wss = new WebSocketServer({ noServer: true });
    const server = createAdaptorServer({ fetch: app.fetch, websocket: { server: wss } });
    try {
      const port = await listen(server, candidate);
      bound = { server, wss, port };
    } catch (error) {
      wss.close();
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || requested === 0) throw error;
      log.info('port busy, trying the next one', { port: candidate });
    }
  }

  if (bound === undefined) {
    throw new Error(`No free port on ${HOST} in ${requested}-${lastTried}`);
  }

  const { server, wss, port } = bound;
  const url = `http://${HOST}:${port}`;
  const version = pkg.version;
  if (port !== requested && requested !== 0) {
    log.warn('requested port was busy', { requested, port });
  }
  log.info('server listening', { url, port, version });

  bus.emit({ type: 'server.started', at: new Date().toISOString(), version });

  if (options.open === true) {
    try {
      await openBrowser(url);
    } catch (error) {
      log.warn('could not open a browser', { url, reason: String(error) });
    }
  }

  return {
    url,
    port,
    version,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close((error) => (error ? reject(error) : resolve()));
        if ('closeAllConnections' in server) server.closeAllConnections();
      }),
  };
}

function listen(server: ReturnType<typeof createAdaptorServer>, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}
