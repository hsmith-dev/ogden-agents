/**
 * The security gate (AD-15 as amended in story 2.1): one Hono middleware that
 * every HTTP request and WebSocket upgrade passes before any route. In order
 * it checks:
 *
 * 1. `Host` is exactly `127.0.0.1:<port>` or `localhost:<port>` (403), which
 *    defeats DNS rebinding;
 * 2. `POST /api/v1/tab/exchange` with `{ code }`: the launcher opened
 *    `/#c=<code>`, and the page's boot script sends the single-use launch code
 *    here (Host and Origin checked, no token needed). The response body
 *    carries a new per-tab token, so the token never appears in any URL; no
 *    cookie is set;
 * 3. static app files (GET or HEAD outside `/api`, `/ws` and `/launcher`, and
 *    not a WebSocket upgrade) pass without a token: they hold no user data,
 *    and a tab without a token shows the app's own "Open Ogden Agents" state.
 *    Only the static handler and the SPA shell serve such paths; a test
 *    enumerates the app's routes to keep it that way;
 * 4. everything else needs this tab's token: the subprotocols `ogden.v1` and
 *    `ogden.auth.<token>` on a real WebSocket upgrade to `/ws`, and
 *    `Authorization: Bearer <token>` on every other request (401). Cookies
 *    are ignored;
 * 5. on WebSocket upgrades and on every method but GET, HEAD and OPTIONS, an
 *    `Origin` of `http://127.0.0.1:<port>` or `http://localhost:<port>` (403);
 * 6. the launcher handshake (`/launcher/…`) needs the launcher token in its
 *    header (401) and nothing else: no tab token opens it, and it opens
 *    nothing but the handshake (see `launcher-token.ts`). Its paths are
 *    matched right after the Host check, so rules 2 to 5 never apply to it.
 *
 * Every response carries a Content-Security-Policy that allows only the
 * app's own scripts. Refusals carry no event data. Launch codes, tab tokens
 * and the launcher token are never logged (AD-16).
 */
import type { Context, MiddlewareHandler } from 'hono';
import { API_ROUTES, LAUNCH_CODE_FRAGMENT_PARAM } from '@ogden-agents/shared';
import { bearerToken, webSocketToken, type LaunchCodes, type TabTokens } from './auth.js';
import { LAUNCHER_TOKEN_HEADER, type LauncherToken } from './launcher-token.js';
import type { Logger } from './log.js';
import { isLauncherPath, isServerPath, isWsPath } from './paths.js';

export interface GateOptions {
  /** The bound port; `undefined` until the server is listening, when every request is refused. */
  port: () => number | undefined;
  codes: LaunchCodes;
  tabs: TabTokens;
  /** The launcher token; without one, the handshake prefix refuses everything. */
  launcherToken?: Pick<LauncherToken, 'verify'>;
  log: Logger;
}

/** A launch link: the app's origin with the single-use code in the fragment, `/#c=<code>`. */
export function launchUrl(origin: string, code: string): string {
  return `${origin}/#${LAUNCH_CODE_FRAGMENT_PARAM}=${code}`;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The app's Content-Security-Policy for the server on `port`: scripts only
 * from the app's own origin (no inline script, no third-party origin), and
 * connections only back to it. Inline styles stay allowed: the UI's
 * components set `style` for positioning.
 */
export function contentSecurityPolicy(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    // 'self' covers ws: in current browsers; the explicit origins cover older ones.
    `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * A real WebSocket upgrade: a GET with `Upgrade: websocket` and `Connection`
 * listing `upgrade`, the only requests Node hands to the WebSocket server. An
 * ordinary request that merely carries an `Upgrade` header is not one.
 */
function isRealUpgrade(c: Context): boolean {
  if (c.req.method !== 'GET' || c.req.header('upgrade')?.toLowerCase() !== 'websocket') return false;
  return (c.req.header('connection') ?? '')
    .split(',')
    .some((part) => part.trim().toLowerCase() === 'upgrade');
}

const unauthorized = (c: Context, message = 'This tab is not connected to Ogden Agents.') =>
  c.json({ error: { code: 'unauthorized', message } }, 401);

export function createGate({ port, codes, tabs, launcherToken, log }: GateOptions): MiddlewareHandler {
  return async (c, next) => {
    const bound = port();
    if (bound === undefined) return c.text('Forbidden', 403);
    const allowedHosts = [`127.0.0.1:${bound}`, `localhost:${bound}`];
    // Set before any response is made, so refusals, routes and upgrades alike carry it.
    c.header('Content-Security-Policy', contentSecurityPolicy(bound));

    if (!allowedHosts.includes(c.req.header('host') ?? '')) return c.text('Forbidden', 403);

    const path = c.req.path;
    const upgrade = isRealUpgrade(c);
    const originOk = () => {
      const origin = c.req.header('origin');
      return origin !== undefined && allowedHosts.some((host) => origin === `http://${host}`);
    };

    if (isLauncherPath(path)) {
      if (launcherToken === undefined || !launcherToken.verify(c.req.header(LAUNCHER_TOKEN_HEADER))) {
        log.warn('launcher token rejected', { path });
        return c.json({ error: { code: 'unauthorized', message: 'A valid launcher token is required.' } }, 401);
      }
      // The launcher is not a browser: it sends no tab token and no Origin. The
      // launcher token, readable only by this OS user, is what a page can never send.
      await next();
      return;
    }

    if (path === API_ROUTES.tabExchange && c.req.method === 'POST' && !upgrade) {
      if (!originOk()) return c.text('Forbidden', 403);
      let code: unknown;
      try {
        code = ((await c.req.json()) as { code?: unknown } | null)?.code;
      } catch {
        code = undefined;
      }
      if (typeof code !== 'string' || !codes.redeem(code)) {
        log.warn('launch code rejected');
        return unauthorized(c, 'This link has expired or was already used. Run `npx ogden-agents` (or `ogden`) again.');
      }
      const token = tabs.mint();
      log.info('launch code used; tab token minted');
      return c.json({ token }, 200, { 'Cache-Control': 'no-store' });
    }

    const isStatic = !upgrade && (c.req.method === 'GET' || c.req.method === 'HEAD') && !isServerPath(path);
    if (isStatic) {
      await next();
      return;
    }

    // The subprotocol carries the token only on a real upgrade to the event socket.
    const token = upgrade && isWsPath(path) ? webSocketToken(c.req.header('sec-websocket-protocol')) : bearerToken(c.req.header('authorization'));
    if (!tabs.verify(token)) return unauthorized(c);

    if ((upgrade || !SAFE_METHODS.has(c.req.method)) && !originOk()) return c.text('Forbidden', 403);

    await next();
  };
}
