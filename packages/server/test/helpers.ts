import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, webSocketProtocols } from '@ogden-agents/shared';
import { afterEach } from 'vitest';

const dirs: string[] = [];

// Registered before any test file's own afterEach hooks, so it runs after them
// (hooks run in reverse order): servers are closed before their folders go.
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A fresh temp data folder, removed after the test. */
export function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-server-'));
  dirs.push(dir);
  return dir;
}

/** What a connected tab sends: its token and the page's own origin. */
export interface SignedIn {
  token: string;
  origin: string;
  /** `Authorization: Bearer <token>` and `Origin`, for REST calls. */
  headers: Record<string, string>;
  /** The subprotocols a tab offers on `/ws`. */
  protocols: [string, string];
}

const signedIn = new WeakMap<object, Promise<SignedIn>>();

/**
 * Connects a tab the way a browser does (AD-15 as amended): exchanges the
 * server's single-use launch link for a tab token. Cached per server, since
 * the code can be spent only once.
 */
export function signIn(server: { url: string; launchUrl: string }): Promise<SignedIn> {
  let pending = signedIn.get(server);
  if (pending === undefined) {
    pending = exchange(server.launchUrl).then((token) => tabOf(token, server.url));
    signedIn.set(server, pending);
  }
  return pending;
}

/** What a tab holding `token` sends to the server at `origin`. */
export function tabOf(token: string, origin: string): SignedIn {
  return {
    token,
    origin,
    headers: { authorization: `Bearer ${token}`, origin },
    protocols: webSocketProtocols(token),
  };
}

/** The launch code in a launch link (`<origin>/#c=<code>`). */
export function codeOfLink(launchUrl: string): string {
  const match = /^#c=([A-Za-z0-9_-]{43})$/.exec(new URL(launchUrl).hash);
  if (match === null) throw new Error(`not a launch link: ${launchUrl.replace(/#.*/, '#…')}`);
  return match[1]!;
}

/**
 * Opens a launch link as the page's boot script does: POSTs its code to
 * `/api/v1/tab/exchange` with the page's Origin and returns the tab token from
 * the response body. Checks that no cookie was set.
 */
export async function exchange(launchUrl: string): Promise<string> {
  const { origin } = new URL(launchUrl);
  const response = await fetch(`${origin}${API_ROUTES.tabExchange}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ code: codeOfLink(launchUrl) }),
  });
  if (response.status !== 200) throw new Error(`the code exchange returned ${response.status}, not 200`);
  if (response.headers.get('set-cookie') !== null) throw new Error('the code exchange set a cookie');
  const { token } = (await response.json()) as { token?: unknown };
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('the code exchange returned no token');
  return token;
}
