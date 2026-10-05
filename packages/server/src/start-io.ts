/**
 * The helpers `start.ts` uses around its HTTP server and WebSocket (moved
 * from `start.ts` in entry 4.12, which keeps it under 600 lines): listening
 * on the loopback host, closing, broadcasting a schema-checked message, and
 * re-pointing an app shortcut that is already there.
 */
import type { AddressInfo } from 'node:net';
import type { createAdaptorServer } from '@hono/node-server';
import type { AppShortcutPort } from '@ogden-agents/core';
import { ServerMessage } from '@ogden-agents/shared';
import type { WebSocketServer } from 'ws';
import type { Logger } from './log.js';
import { shortcutErrorCode } from './shortcut-routes.js';

/** The only interface the server ever binds (AD-15). */
export const HOST = '127.0.0.1';

/**
 * Re-points an app shortcut that is already there at this server's Node and
 * launcher, which may have moved since it was added (a Node upgrade, a new
 * npx cache). It never creates one; a failure is logged, without paths, and
 * the server runs on.
 */
export async function repointAppShortcut(appShortcut: AppShortcutPort, log: Logger): Promise<void> {
  try {
    if (!(await appShortcut.status()).installed) return;
    await appShortcut.add();
  } catch (error) {
    log.warn('could not re-point the app shortcut', { code: shortcutErrorCode(error) });
  }
}

/** Sends one schema-checked message to every connected WebSocket client. */
export function broadcast(wss: WebSocketServer, message: ServerMessage, log: Logger): void {
  const parsed = ServerMessage.safeParse(message);
  if (!parsed.success) {
    log.error('refusing to broadcast a message that fails the shared schema', { issues: parsed.error.issues });
    return;
  }
  const text = JSON.stringify(parsed.data);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(text);
  }
}

/** Stops the WebSocket clients and the HTTP server, and resolves once the port is released. */
export function closeServer(server: ReturnType<typeof createAdaptorServer>, wss: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close((error) => (error ? reject(error) : resolve()));
    if ('closeAllConnections' in server) server.closeAllConnections();
  });
}

export function listen(server: ReturnType<typeof createAdaptorServer>, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}
