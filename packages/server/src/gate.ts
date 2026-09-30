/**
 * The security gate (AD-15): one Hono middleware that every HTTP request and
 * WebSocket upgrade passes before any route. In order it checks:
 *
 * 1. `Host` is exactly `127.0.0.1:<port>` or `localhost:<port>` (403), which
 *    defeats DNS rebinding;
 * 2. `GET /auth?code=…` exchanges a launch code for the session cookie and
 *    redirects (303) to `/`; this is the only thing reachable without a cookie;
 * 3. a valid signed session cookie (401);
 * 4. on WebSocket upgrades and on every method but GET, HEAD and OPTIONS, an
 *    `Origin` of `http://127.0.0.1:<port>` or `http://localhost:<port>` (403).
 *
 * Refusals carry no event data. Launch codes are never logged (AD-16).
 */
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { sessionCookieName, type LaunchCodes, type Sessions } from './auth.js';
import type { Logger } from './log.js';

export interface GateOptions {
  /** The bound port; `undefined` until the server is listening, when every request is refused. */
  port: () => number | undefined;
  codes: LaunchCodes;
  sessions: Sessions;
  log: Logger;
}

/** The path of the launch code exchange. */
export const AUTH_PATH = '/auth';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Shown for an unauthenticated `GET /`: how to get in, and nothing else. */
export const OPEN_FROM_TERMINAL_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ogden Agents</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">
<h1>Open Ogden Agents from your terminal</h1>
<p>This browser isn't signed in to Ogden Agents. Run <code>npx ogden-agents</code> (or <code>ogden</code>) in a terminal: it opens the app here with a one-time link.</p>
</body>
</html>
`;

export function createGate({ port, codes, sessions, log }: GateOptions): MiddlewareHandler {
  return async (c, next) => {
    const bound = port();
    if (bound === undefined) return c.text('Forbidden', 403);
    const allowedHosts = [`127.0.0.1:${bound}`, `localhost:${bound}`];
    const cookieName = sessionCookieName(bound);

    if (!allowedHosts.includes(c.req.header('host') ?? '')) return c.text('Forbidden', 403);

    if (c.req.path === AUTH_PATH && c.req.method === 'GET') {
      const code = c.req.query('code');
      if (code === undefined || !codes.redeem(code)) {
        log.warn('launch code rejected');
        return c.text('This link has expired or was already used. Run `npx ogden-agents` (or `ogden`) again.', 401);
      }
      log.info('launch code used');
      const session = sessions.create();
      setCookie(c, cookieName, session.value, {
        httpOnly: true,
        sameSite: 'Strict',
        path: '/',
        maxAge: session.maxAgeSeconds,
      });
      // 303 takes the (now spent) code out of the address bar.
      return c.redirect('/', 303);
    }

    if (!sessions.verify(getCookie(c, cookieName))) {
      if (c.req.path === '/' && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
        return c.html(OPEN_FROM_TERMINAL_PAGE, 401);
      }
      return c.text('Unauthorized', 401);
    }

    const isUpgrade = c.req.header('upgrade')?.toLowerCase() === 'websocket';
    if (isUpgrade || !SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin === undefined || !allowedHosts.some((host) => origin === `http://${host}`)) {
        return c.text('Forbidden', 403);
      }
    }

    await next();
  };
}
