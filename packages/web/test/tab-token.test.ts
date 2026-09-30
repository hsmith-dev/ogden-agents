import { runInNewContext } from 'node:vm';
import { API_ROUTES, APPEARANCE_STORAGE_KEY, TAB_TOKEN_STORAGE_KEY, WS_PROTOCOL } from '@ogden-agents/shared';
import { describe, expect, it, vi } from 'vitest';
import { bootScript } from '../vite.config';
import { createTabAuth, NotConnectedError } from '../src/auth/tab-token';

const TOKEN = 'T'.repeat(43);

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const CODE = 'C'.repeat(43);

/**
 * Runs the built boot script against a fake page at `href`, whose exchange
 * endpoint answers with `answer` (a token, or an HTTP status).
 */
async function boot(href: string, { storageBlocked = false, answer = TOKEN as string | number, historyApi = true } = {}) {
  const url = new URL(href);
  const session = memoryStorage();
  const attributes = new Map<string, string>();
  const replaced: string[] = [];
  const locationReplaced: string[] = [];
  const requests: Array<{ path: string; init: RequestInit }> = [];
  const window: Record<string, unknown> = {
    location: {
      get hash() {
        return url.hash;
      },
      set hash(_value: string) {
        throw new Error('boot must not assign location.hash (it adds a history entry)');
      },
      pathname: url.pathname,
      search: url.search,
      replace: (next: string) => locationReplaced.push(next),
    },
  };
  const context = {
    window,
    document: { documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) } },
    localStorage: memoryStorage({ [APPEARANCE_STORAGE_KEY]: JSON.stringify({ theme: 'dark', density: 'compact' }) }),
    sessionStorage: storageBlocked
      ? {
          setItem: () => {
            throw new Error('blocked');
          },
        }
      : session,
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, next: string) => {
        if (!historyApi) throw new Error('no history API');
        replaced.push(next);
        url.hash = '';
      },
    },
    fetch: async (path: string, init: RequestInit) => {
      requests.push({ path, init });
      return typeof answer === 'number'
        ? new Response(null, { status: answer })
        : new Response(JSON.stringify({ token: answer }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    Promise,
    Object,
    JSON,
  };
  runInNewContext(bootScript(), context);
  const exchange = window.__ogdenTabExchange as Promise<string | null> | undefined;
  const token = exchange === undefined ? undefined : await exchange;
  return { session, attributes, replaced, locationReplaced, url, window, requests, token };
}

describe('boot script', () => {
  it('strips #c=<code> from the URL, exchanges the code over POST, and stores the token; no token in any URL', async () => {
    const run = await boot(`http://127.0.0.1:4317/settings/appearance?x=1#c=${CODE}`);
    expect(run.replaced).toEqual(['/settings/appearance?x=1']);
    expect(run.url.hash).toBe('');
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0]!.path).toBe(API_ROUTES.tabExchange);
    expect(run.requests[0]!.init.method).toBe('POST');
    expect(run.requests[0]!.init.credentials).toBe('omit');
    expect(JSON.parse(String(run.requests[0]!.init.body))).toEqual({ code: CODE });
    expect(run.token).toBe(TOKEN);
    expect(run.session.values.get(TAB_TOKEN_STORAGE_KEY)).toBe(TOKEN);
    for (const next of run.replaced) expect(next).not.toContain(TOKEN);
    // The appearance is applied too, before first paint.
    expect(run.attributes.get('data-theme')).toBe('dark');
    expect(run.attributes.get('data-density')).toBe('compact');
  });

  it('a refused or malformed code stores nothing; other fragments are left alone', async () => {
    const refused = await boot(`http://127.0.0.1:4317/#c=${CODE}`, { answer: 401 });
    expect(refused.token).toBeNull();
    expect(refused.session.values.has(TAB_TOKEN_STORAGE_KEY)).toBe(false);
    expect(refused.replaced).toEqual(['/']);

    const bad = await boot('http://127.0.0.1:4317/#c=short');
    expect(bad.requests).toEqual([]);
    expect(bad.replaced).toEqual(['/']);
    expect(bad.token).toBeNull();

    const other = await boot('http://127.0.0.1:4317/#section');
    expect(other.replaced).toEqual([]);
    expect(other.url.hash).toBe('#section');
    expect(other.window.__ogdenTabExchange).toBeUndefined();
  });

  it('with storage blocked, the app gets the token from the exchange promise, in memory only', async () => {
    const run = await boot(`http://127.0.0.1:4317/#c=${CODE}`, { storageBlocked: true });
    expect(run.token).toBe(TOKEN);
    expect(Object.keys(run.window)).not.toContain('__ogdenTabExchange');
  });

  it('without the history API, reloads with location.replace (no history entry) after the exchange', async () => {
    const run = await boot(`http://127.0.0.1:4317/settings?x=1#c=${CODE}`, { historyApi: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run.locationReplaced).toEqual(['/settings?x=1']);
    expect(run.session.values.get(TAB_TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  it('has no placeholder left', () => {
    expect(bootScript()).not.toMatch(/__[A-Z_]+__/);
  });
});

describe('tab auth', () => {
  it('reads the token from sessionStorage and sends it as Bearer, with no cookies', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const auth = createTabAuth({ storage: memoryStorage({ [TAB_TOKEN_STORAGE_KEY]: TOKEN }), fetchImpl });
    expect(auth.token()).toBe(TOKEN);
    expect(auth.webSocketProtocols()).toEqual([WS_PROTOCOL, `ogden.auth.${TOKEN}`]);
    await auth.fetch(API_ROUTES.tabCheck, { headers: { 'content-type': 'application/json' } });
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(API_ROUTES.tabCheck);
    expect(init.credentials).toBe('omit');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('forgets the token on a 401, clears storage and tells listeners once', async () => {
    const storage = memoryStorage({ [TAB_TOKEN_STORAGE_KEY]: TOKEN });
    const auth = createTabAuth({ storage, fetchImpl: async () => new Response(null, { status: 401 }) });
    const lost = vi.fn();
    auth.onForget(lost);
    expect((await auth.fetch(API_ROUTES.tabCheck)).status).toBe(401);
    expect(auth.token()).toBeUndefined();
    expect(storage.values.has(TAB_TOKEN_STORAGE_KEY)).toBe(false);
    expect(lost).toHaveBeenCalledOnce();
    auth.forget();
    expect(lost).toHaveBeenCalledOnce();
    await expect(auth.fetch(API_ROUTES.tabCheck)).rejects.toBeInstanceOf(NotConnectedError);
  });

  it('with no token (a bookmark or a new tab) is not connected; a malformed stored value is ignored', () => {
    expect(createTabAuth({ storage: memoryStorage() }).token()).toBeUndefined();
    expect(createTabAuth({ storage: memoryStorage({ [TAB_TOKEN_STORAGE_KEY]: 'nope' }) }).token()).toBeUndefined();
    expect(createTabAuth({ storage: memoryStorage() }).webSocketProtocols()).toBeUndefined();
  });

  it('takes the token from the boot exchange once it settles; a failed exchange keeps an existing one', async () => {
    const fresh = createTabAuth({ storage: memoryStorage(), exchange: Promise.resolve(TOKEN) });
    await fresh.ready;
    expect(fresh.token()).toBe(TOKEN);
    const other = 'O'.repeat(43);
    const kept = createTabAuth({ storage: memoryStorage({ [TAB_TOKEN_STORAGE_KEY]: other }), exchange: Promise.resolve(null) });
    await kept.ready;
    expect(kept.token()).toBe(other);
    const replaced = createTabAuth({ storage: memoryStorage({ [TAB_TOKEN_STORAGE_KEY]: other }), exchange: Promise.resolve(TOKEN) });
    await replaced.ready;
    expect(replaced.token()).toBe(TOKEN);
    expect(createTabAuth({ storage: memoryStorage() }).webSocketProtocols()).toBeUndefined();
  });
});
