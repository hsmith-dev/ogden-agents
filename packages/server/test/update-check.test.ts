/**
 * The "newer version" notice (story 13.7) against a real server and a fake
 * registry: what is sent, once per start, the switch, offline, silent
 * failures, the timeout and size cap, Check now, and the event. No test
 * reaches the network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_ROUTES, UpdateCheckResponse, UpdateNoticeResponse, type CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it, vi } from 'vitest';
import { DIST_TAGS_URL, installMethodOf, isOffline, MAX_BODY_BYTES, UPDATE_CHECK_FILE, wireUpdateCheck, type UpdateFetch, type UpdateRequestInit } from '../src/update-check.js';
import { VERSION } from '../src/version.js';
import { send, signIn, startTestServer, waitFor, type TestServer } from './helpers.js';

/** A registry that answers `tags` and remembers every request. */
function registry(tags: Record<string, string> | Response | (() => Promise<Response>)) {
  const calls: Array<{ url: string; init: UpdateRequestInit }> = [];
  const fetch: UpdateFetch = async (url, init) => {
    calls.push({ url, init });
    if (typeof tags === 'function') return tags();
    return tags instanceof Response ? tags : Response.json(tags);
  };
  return { calls, fetch };
}

const bump = (version: string, by = 1): string => {
  const [major, minor, patch] = version.split('-')[0]!.split('.').map(Number) as [number, number, number];
  return `${major}.${minor}.${patch + by}`;
};
/** A version above the one under test, a stable one. */
const NEWER = bump(VERSION);

const putEnabled = (tab: { headers: Record<string, string> }, enabled: boolean) => ({ method: 'PUT', body: JSON.stringify({ enabled }), headers: { ...tab.headers, 'content-type': 'application/json' } });

async function noticeOf(server: TestServer, headers: Record<string, string>) {
  const reply = await send(server, API_ROUTES.updates, { headers });
  expect(reply.status).toBe(200);
  return UpdateNoticeResponse.parse(reply.json());
}

describe('the update notice', () => {
  it('asks npm once per start, with nothing but the request itself, and reports a newer version', async () => {
    const npm = registry({ latest: NEWER, next: NEWER });
    const server = await startTestServer({ updates: { fetch: npm.fetch } });
    const tab = await signIn(server);
    await waitFor(() => npm.calls.length > 0, 'the start check');
    await waitFor(async () => (await noticeOf(server, tab.headers)).lastCheckedAt !== null, 'the check to finish');
    expect(npm.calls).toHaveLength(1);
    expect(npm.calls[0]!.url).toBe(DIST_TAGS_URL);
    expect(new URL(npm.calls[0]!.url).search).toBe('');
    expect(Object.keys(npm.calls[0]!.init).sort()).toEqual(['headers', 'redirect', 'signal']);
    expect(npm.calls[0]!.init.headers).toEqual({ accept: 'application/json' });
    expect(npm.calls[0]!.init.redirect).toBe('error');
    const notice = await noticeOf(server, tab.headers);
    expect(notice.current).toBe(VERSION);
    expect(notice.available).toEqual({ version: NEWER, tag: 'latest' });
    // Nothing about this install is on disk but the switch and the time.
    const saved = JSON.parse(readFileSync(join(server.dataDir, UPDATE_CHECK_FILE), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['lastCheckedAt']);
  });

  it('reports nothing when the registry has the same or an older version', async () => {
    const npm = registry({ latest: VERSION, next: VERSION });
    const server = await startTestServer({ updates: { fetch: npm.fetch } });
    const tab = await signIn(server);
    await waitFor(async () => (await noticeOf(server, tab.headers)).lastCheckedAt !== null, 'the check to finish');
    expect((await noticeOf(server, tab.headers)).available).toBeNull();
  });

  it('makes no request at start when the switch is off, and the switch is kept', async () => {
    const npm = registry({ latest: NEWER });
    const server = await startTestServer({ updates: { fetch: npm.fetch } });
    const tab = await signIn(server);
    await waitFor(() => npm.calls.length === 1, 'the start check');
    const off = await send(server, API_ROUTES.updates, putEnabled(tab, false));
    expect(UpdateNoticeResponse.parse(off.json()).enabled).toBe(false);
    expect((await noticeOf(server, tab.headers)).enabled).toBe(false);
    await server.close();

    const again = registry({ latest: NEWER });
    const restarted = await startTestServer({ dataDir: server.dataDir, updates: { fetch: again.fetch } });
    const tab2 = await signIn(restarted);
    expect((await noticeOf(restarted, tab2.headers)).enabled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(again.calls).toHaveLength(0);
    // Check now is the user asking, so it still goes through.
    const checked = UpdateCheckResponse.parse((await send(restarted, API_ROUTES.updatesCheck, { method: 'POST', headers: tab2.headers })).json());
    expect(checked.outcome).toBe('newer');
    expect(again.calls).toHaveLength(1);
  });

  it('appends one event when a check finishes and one when the switch changes', async () => {
    const npm = registry({ latest: NEWER });
    const server = await startTestServer({ updates: { fetch: npm.fetch } });
    const tab = await signIn(server);
    await waitFor(async () => (await noticeOf(server, tab.headers)).lastCheckedAt !== null, 'the check to finish');
    await send(server, API_ROUTES.updates, putEnabled(tab, false));
    // Unchanged: nothing more.
    await send(server, API_ROUTES.updates, putEnabled(tab, false));
    const events = server.core.events.readAfter(0).filter((event): event is Extract<CoreEvent, { type: 'settings.update_notice_changed' }> => event.type === 'settings.update_notice_changed');
    expect(events.map((event) => event.payload)).toEqual([
      { available: NEWER, enabled: true },
      { available: NEWER, enabled: false },
    ]);
  });

  it('stays silent when npm is unreachable, answers badly, or sends too much, and Check now says failed', async () => {
    for (const tags of [
      () => Promise.reject(new Error('ENOTFOUND')),
      async () => new Response('nope', { status: 503 }),
      async () => new Response('not json'),
      async () => Response.json({ latest: 5 }),
      async () => new Response('x'.repeat(MAX_BODY_BYTES + 1)),
    ]) {
      const npm = registry(tags);
      const lines: string[] = [];
      const server = await startTestServer({ lines, updates: { fetch: npm.fetch } });
      const tab = await signIn(server);
      await waitFor(() => npm.calls.length === 1, 'the start check');
      await waitFor(() => lines.join('').includes('update check did not finish'), 'the quiet log line');
      const notice = await noticeOf(server, tab.headers);
      expect(notice.available).toBeNull();
      expect(notice.lastCheckedAt).toBeNull();
      expect(lines.join('')).not.toContain('"level":"error"');
      const manual = UpdateCheckResponse.parse((await send(server, API_ROUTES.updatesCheck, { method: 'POST', headers: tab.headers })).json());
      expect(manual.outcome).toBe('failed');
      await server.close();
    }
  });

  it('gives up on a slow registry and never delays the page', async () => {
    const npm = registry(
      () => new Promise<Response>(() => {}), // never answers
    );
    const slow: UpdateFetch = (url, init) =>
      new Promise((resolve, reject) => {
        void npm.fetch(url, init).then(resolve, reject);
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const started = Date.now();
    const server = await startTestServer({ updates: { fetch: slow, timeoutMs: 50 } });
    expect(Date.now() - started).toBeLessThan(2000);
    const tab = await signIn(server);
    const checked = UpdateCheckResponse.parse((await send(server, API_ROUTES.updatesCheck, { method: 'POST', headers: tab.headers })).json());
    expect(checked.outcome).toBe('failed');
  });

  it('needs a tab token on every route', async () => {
    const server = await startTestServer({ updates: { fetch: registry({}).fetch } });
    expect((await send(server, API_ROUTES.updates)).status).toBe(401);
    expect((await send(server, API_ROUTES.updatesCheck, { method: 'POST' })).status).toBe(401);
    expect((await send(server, API_ROUTES.updates, { method: 'PUT', body: '{"enabled":false}', headers: { 'content-type': 'application/json' } })).status).toBe(401);
  });

  it('makes no request in a test run with no fake client, nor with updates off', async () => {
    const real = vi.spyOn(globalThis, 'fetch');
    try {
      const server = await startTestServer();
      const tab = await signIn(server);
      const checked = UpdateCheckResponse.parse((await send(server, API_ROUTES.updatesCheck, { method: 'POST', headers: tab.headers })).json());
      expect(checked.outcome).toBe('offline');
      const off = await startTestServer({ updates: false });
      const tab2 = await signIn(off);
      expect(UpdateCheckResponse.parse((await send(off, API_ROUTES.updatesCheck, { method: 'POST', headers: tab2.headers })).json()).outcome).toBe('offline');
      expect(real.mock.calls.filter(([url]) => String(url).includes('registry.npmjs.org'))).toHaveLength(0);
    } finally {
      real.mockRestore();
    }
  });
});

describe('wireUpdateCheck, offline and install method', () => {
  const rest = (dataDir: string) => ({ dataDir, version: '0.4.0', installMethod: 'npx' as const, events: { append: () => undefined } as never, log: { info() {}, warn() {}, error() {} } });

  it('OGDEN_AGENTS_OFFLINE stops every request, Check now included', async () => {
    const npm = registry({ latest: '0.5.0' });
    const dataDir = (await import('./helpers.js')).tempDataDir();
    const check = wireUpdateCheck({ fetch: npm.fetch }, rest(dataDir), { OGDEN_AGENTS_OFFLINE: '1' });
    await check.runOnStart();
    expect((await check.checkNow()).outcome).toBe('offline');
    expect(check.notice().offline).toBe(true);
    expect(npm.calls).toHaveLength(0);
  });

  it('runs the start check only once', async () => {
    const npm = registry({ latest: '0.5.0' });
    const dataDir = (await import('./helpers.js')).tempDataDir();
    const check = wireUpdateCheck({ fetch: npm.fetch }, rest(dataDir), {});
    await check.runOnStart();
    await check.runOnStart();
    expect(npm.calls).toHaveLength(1);
    expect(check.notice().available).toEqual({ version: '0.5.0', tag: 'latest' });
  });

  it('reads OGDEN_AGENTS_OFFLINE as on for any value but empty, 0 or false', () => {
    expect([undefined, '', '0', 'false', ' FALSE '].map((value) => isOffline({ OGDEN_AGENTS_OFFLINE: value }))).toEqual([false, false, false, false, false]);
    expect(['1', 'true', 'yes'].map((value) => isOffline({ OGDEN_AGENTS_OFFLINE: value }))).toEqual([true, true, true]);
  });

  it('tells npx from a global install from the launcher path', () => {
    expect(installMethodOf('/home/me/.npm/_npx/abc123/node_modules/ogden-agents/bin/ogden.js')).toBe('npx');
    expect(installMethodOf('C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\1a\\node_modules\\ogden-agents\\bin\\ogden.js')).toBe('npx');
    expect(installMethodOf('/usr/lib/node_modules/ogden-agents/bin/ogden.js')).toBe('global');
    expect(installMethodOf('/work/ogden-agents/bin/ogden.js')).toBe('other');
    expect(installMethodOf(undefined)).toBe('other');
  });
});
