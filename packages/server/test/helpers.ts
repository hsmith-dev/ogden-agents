import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

/** What a signed-in browser sends: its session cookie and the page's own origin. */
export interface SignedIn {
  cookie: string;
  origin: string;
}

const signedIn = new WeakMap<object, Promise<SignedIn>>();

/**
 * Signs in the way a browser does (AD-15): exchanges the server's single-use
 * launch link for the session cookie. Cached per server, since the code can be
 * spent only once.
 */
export function signIn(server: { url: string; launchUrl: string }): Promise<SignedIn> {
  let pending = signedIn.get(server);
  if (pending === undefined) {
    pending = exchange(server.launchUrl).then((cookie) => ({ cookie, origin: server.url }));
    signedIn.set(server, pending);
  }
  return pending;
}

/** Exchanges a launch link and returns the `name=value` of the session cookie it sets. */
export async function exchange(launchUrl: string): Promise<string> {
  const response = await fetch(launchUrl, { redirect: 'manual' });
  if (response.status !== 303) throw new Error(`launch link returned ${response.status}, not 303`);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie === null) throw new Error('launch link set no cookie');
  return setCookie.split(';')[0]!;
}
