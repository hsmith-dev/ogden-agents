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
import { APPEARANCE_STORAGE_KEY } from '@ogden-agents/shared';
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

/**
 * Shown for an unauthenticated page request: how to get in, and nothing else.
 * React can't load without a session (its assets are gated), so this page is
 * server-rendered and styled inline with DESIGN.md's tokens (launch-page),
 * in light and dark. The saved Light or Dark override from Settings >
 * Appearance is honored too, since it lives in this origin's localStorage.
 * Fonts fall back to the system stack: the self-hosted Geist files are gated.
 */
export const OPEN_FROM_TERMINAL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ogden Agents</title>
<script>
try {
  var saved = JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)}) || '{}');
  if (saved.theme === 'light' || saved.theme === 'dark') document.documentElement.setAttribute('data-theme', saved.theme);
} catch (e) {}
</script>
<style>
/* Copied from packages/web/src/ui/tokens.css; tests/design-tokens.test.ts checks every value. */
:root {
  color-scheme: light;
  --background: #F6F7F5;
  --foreground: #141715;
  --muted: #ECEFEB;
  --muted-foreground: #5C645D;
  --border: #DCE0DA;
  --primary: #1B1F1C;
  --primary-foreground: #F6F7F5;
  --ring: #2F4FD8;
  --family-sans: 'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif;
  --family-mono: 'Geist Mono Variable', 'Geist Mono', ui-monospace, 'SFMono-Regular', monospace;
  --type-display-size: 28px;
  --type-display-weight: 600;
  --type-display-line-height: 1.15;
  --type-display-tracking: -0.02em;
  --type-heading-weight: 600;
  --type-body-size: 15px;
  --type-body-line-height: 1.55;
  --type-label-size: 13px;
  --type-label-weight: 500;
  --type-label-line-height: 1.3;
  --type-mono-size: 13px;
  --type-mono-line-height: 1.5;
  --rounded-md: 6px;
  --rounded-lg: 10px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --button-height: 36px;
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;
  --measure: 70ch;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --background: #0F1210;
    --foreground: #E6EAE6;
    --muted: #1C211D;
    --muted-foreground: #959E96;
    --border: #262C27;
    --primary: #E6EAE6;
    --primary-foreground: #111412;
    --ring: #8198FF;
  }
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --background: #0F1210;
  --foreground: #E6EAE6;
  --muted: #1C211D;
  --muted-foreground: #959E96;
  --border: #262C27;
  --primary: #E6EAE6;
  --primary-foreground: #111412;
  --ring: #8198FF;
}
* { box-sizing: border-box; }
html { height: 100%; }
html, body { background: var(--background); color: var(--foreground); }
body {
  margin: 0; min-height: 100%; display: grid; place-items: center; padding: var(--space-6) var(--space-4);
  font-family: var(--family-sans); font-size: var(--type-body-size); line-height: var(--type-body-line-height);
  -webkit-font-smoothing: antialiased;
}
main { width: 100%; max-width: var(--measure); display: flex; flex-direction: column; gap: var(--space-4); }
.wordmark { display: flex; align-items: center; gap: var(--space-2); font-size: var(--type-label-size); font-weight: var(--type-heading-weight); line-height: var(--type-label-line-height); }
.mark { display: grid; place-items: center; width: var(--button-height); height: var(--button-height); border-radius: var(--rounded-md); background: var(--primary); color: var(--primary-foreground); }
h1 {
  margin: var(--space-4) 0 0; font-size: var(--type-display-size); font-weight: var(--type-display-weight);
  line-height: var(--type-display-line-height); letter-spacing: var(--type-display-tracking);
}
p { margin: 0; color: var(--muted-foreground); max-width: var(--measure); }
code { font-family: var(--family-mono); font-size: var(--type-mono-size); }
.command {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  border: thin solid var(--border); border-radius: var(--rounded-lg); background: var(--muted);
}
.command code { color: var(--foreground); line-height: var(--type-mono-line-height); overflow-wrap: anywhere; }
button {
  height: var(--button-height); padding: 0 var(--space-3); border: 0; border-radius: var(--rounded-md); cursor: pointer;
  background: var(--primary); color: var(--primary-foreground);
  font: inherit; font-size: var(--type-label-size); font-weight: var(--type-label-weight); line-height: var(--type-label-line-height); white-space: nowrap;
}
button:active { transform: scale(0.98); }
.status { font-size: var(--type-label-size); line-height: var(--type-label-line-height); min-height: var(--type-label-size); }
:focus-visible { outline: var(--focus-ring-width) solid var(--ring); outline-offset: var(--focus-ring-offset); }
</style>
</head>
<body>
<main>
<div class="wordmark"><span class="mark" aria-hidden="true">O</span>Ogden Agents</div>
<h1>Open Ogden Agents from your terminal</h1>
<p>This browser isn't signed in to Ogden Agents. Run <code>npx ogden-agents</code> (or <code>ogden</code>) in a terminal: it opens the app here with a one-time link.</p>
<div class="command"><code id="command">npx ogden-agents</code><button type="button" id="copy">Copy</button></div>
<p class="status" id="copy-status" role="status"></p>
</main>
<script>
(function () {
  var button = document.getElementById('copy');
  var status = document.getElementById('copy-status');
  var failed = function () {
    button.textContent = 'Copy';
    status.textContent = "Couldn't copy. The command is selected; copy it with your keyboard.";
    var range = document.createRange();
    range.selectNodeContents(document.getElementById('command'));
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
  button.addEventListener('click', function () {
    status.textContent = '';
    try {
      navigator.clipboard.writeText('npx ogden-agents').then(function () {
        button.textContent = 'Copied';
        setTimeout(function () { button.textContent = 'Copy'; }, 1500);
      }, failed);
    } catch (e) {
      failed();
    }
  });
})();
</script>
</body>
</html>
`;

/**
 * A browser navigating to a page (not fetching an asset or calling the API):
 * a GET or HEAD that accepts HTML. Without a session these get the launch
 * page, so a bookmarked app URL such as `/settings/appearance` explains how
 * to get in (EXPERIENCE.md State Patterns: Unauthenticated).
 */
function isPageRequest(method: string, path: string, accept: string | undefined): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (path === '/') return true;
  return (accept ?? '').includes('text/html') && !/\.[A-Za-z0-9]+$/.test(path);
}

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
      if (isPageRequest(c.req.method, c.req.path, c.req.header('accept'))) {
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
