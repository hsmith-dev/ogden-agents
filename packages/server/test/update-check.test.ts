/**
 * The "newer version" notice (story 13.7, GitHub Releases in 13.14) against a
 * real server and fake registries: what is sent, once per start, the switch, offline, silent
 * failures, the timeout and size cap, Check now, and the event. No test
 * reaches the network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_ROUTES, UpdateCheckResponse, UpdateNoticeResponse, type CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it, vi } from 'vitest';
import { DIST_TAGS_URL, GITHUB_LATEST_URL, GITHUB_MAX_BODY_BYTES, GITHUB_NEXT_URL, installMethodOf, isOffline, MAX_BODY_BYTES, sourcesFor, UPDATE_CHECK_FILE, wireUpdateCheck, type UpdateFetch, type UpdateRequestInit } from '../src/update-check.js';
import { VERSION } from '../src/version.js';
import { send, signIn, startTestServer, tempDataDir, waitFor, type TestServer } from './helpers.js';

/** A launcher path under the GitHub Releases helper's app folder: the install came from GitHub. */
const GITHUB_LAUNCHER = '/home/me/.local/share/ogden-agents-install/versions/0.5.0/node_modules/ogden-agents/bin/ogden.js';

/** One GitHub release answer, as the API sends it (a few fields of many). */
const release = (version: string, extra: Record<string, unknown> = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: version.includes('-'),
  html_url: `https://github.com/hsmith-dev/ogden-agents/releases/tag/v${version}`,
  assets: [{ name: `ogden-agents-${version}.tgz`, url: `https://api.github.com/repos/hsmith-dev/ogden-agents/releases/assets/1`, size: 1234 }],
  ...extra,
});

type Answer = Response | (() => Promise<Response>) | Record<string, unknown> | unknown[];
const answer = (what: Answer): Promise<Response> => (typeof what === 'function' ? what() : Promise.resolve(what instanceof Response ? what : Response.json(what)));

/**
 * The two places the check asks, by URL, and every request made. `npm` answers
 * the dist-tags URL, `github` the releases URLs; a source left out answers 404.
 */
function registry(sources: { npm?: Answer; github?: Answer }) {
  const calls: Array<{ url: string; init: UpdateRequestInit }> = [];
  const fetch: UpdateFetch = async (url, init) => {
    calls.push({ url, init });
    const github = url.includes('/releases?') && sources.github !== undefined && !(sources.github instanceof Response) && typeof sources.github !== 'function' && !Array.isArray(sources.github) ? [sources.github] : sources.github;
    const what = url === DIST_TAGS_URL ? sources.npm : url.startsWith('https://api.github.com/') ? github : undefined;
    return what === undefined ? new Response('missing', { status: 404 }) : answer(what);
  };
  return { calls, fetch, urls: () => calls.map((call) => call.url) };
}

const bump = (version: string, by = 1): string => {
  const [major, minor, patch] = version.split('-')[0]!.split('.').map(Number) as [number, number, number];
  return `${major}.${minor}.${patch + by}`;
};
/** A version above the one under test, a stable one. */
const NEWER = bump(VERSION);
const RUNNING_PREVIEW = VERSION.includes('-');
const RUNNING_GITHUB_URL = RUNNING_PREVIEW ? GITHUB_NEXT_URL : GITHUB_LATEST_URL;

const putEnabled = (tab: { headers: Record<string, string> }, enabled: boolean) => ({ method: 'PUT', body: JSON.stringify({ enabled }), headers: { ...tab.headers, 'content-type': 'application/json' } });

async function noticeOf(server: TestServer, headers: Record<string, string>) {
  const reply = await send(server, API_ROUTES.updates, { headers });
  expect(reply.status).toBe(200);
  return UpdateNoticeResponse.parse(reply.json());
}

describe('the update notice', () => {
  it('asks each source once per start, with nothing but the request itself, and reports a newer version', async () => {
    const world = registry({ npm: { latest: NEWER, next: NEWER }, github: release(NEWER) });
    const server = await startTestServer({ updates: { fetch: world.fetch } });
    const tab = await signIn(server);
    await waitFor(() => world.calls.length >= 2, 'the start check');
    await waitFor(async () => (await noticeOf(server, tab.headers)).lastCheckedAt !== null, 'the check to finish');
    // The running build chooses preview releases or releases/latest from its version.
    expect([...world.urls()].sort()).toEqual([DIST_TAGS_URL, RUNNING_GITHUB_URL].sort());
    for (const call of world.calls) {
      expect(new URL(call.url).search).toBe(call.url === GITHUB_NEXT_URL ? '?per_page=5' : '');
      expect(Object.keys(call.init).sort()).toEqual(['headers', 'redirect', 'signal']);
      expect(call.init.redirect).toBe('error');
    }
    const npmCall = world.calls.find((call) => call.url === DIST_TAGS_URL)!;
    expect(npmCall.init.headers).toEqual({ accept: 'application/json' });
    // GitHub's own headers: no authorization, no cookie, and nothing about this install (no version, no id).
    const githubHeaders = world.calls.find((call) => call.url === RUNNING_GITHUB_URL)!.init.headers;
    expect(Object.keys(githubHeaders).map((name) => name.toLowerCase()).sort()).toEqual(['accept', 'user-agent', 'x-github-api-version']);
    expect(JSON.stringify(githubHeaders)).not.toContain(VERSION);
    const notice = await noticeOf(server, tab.headers);
    expect(notice.current).toBe(VERSION);
    expect(notice.sources).toEqual(['github-releases', 'npm']);
    expect(notice.available).toEqual({ version: NEWER, tag: 'latest', source: 'npm' });
    // Nothing about this install is on disk but the switch and the time.
    const saved = JSON.parse(readFileSync(join(server.dataDir, UPDATE_CHECK_FILE), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['lastCheckedAt']);
  });

  it('asks only GitHub Releases, with one GET, when the install came from GitHub', async () => {
    const world = registry({ npm: { latest: '99.0.0' }, github: release(NEWER) });
    const server = await startTestServer({ launcherEntry: GITHUB_LAUNCHER, updates: { fetch: world.fetch } });
    const tab = await signIn(server);
    await waitFor(async () => (await noticeOf(server, tab.headers)).lastCheckedAt !== null, 'the check to finish');
    expect(world.urls()).toEqual([RUNNING_GITHUB_URL]);
    const notice = await noticeOf(server, tab.headers);
    expect(notice.installMethod).toBe('github');
    expect(notice.sources).toEqual(['github-releases']);
    expect(notice.available).toEqual({ version: NEWER, tag: RUNNING_PREVIEW ? 'next' : 'latest', source: 'github-releases' });
  });

  it('a stable install asks releases/latest and is never offered a prerelease', () => {
    const asked: string[] = [];
    const fetch: UpdateFetch = async (url) => {
      asked.push(url);
      return Response.json(release('0.6.0-rc.1'));
    };
    const check = wireUpdateCheck({ fetch }, { dataDir: tempDataDir(), version: '0.5.0', installMethod: 'github', events: { append: () => undefined } as never, log: { info() {}, warn() {}, error() {} } }, {});
    return check.checkNow().then((result) => {
      expect(asked).toEqual([GITHUB_LATEST_URL]);
      expect(result.outcome).toBe('current');
      expect(result.notice.available).toBeNull();
    });
  });

  it('offers the highest of what the two sources say, and prefers npm on a tie', async () => {
    const dataDir = tempDataDir();
    const rest = { dataDir, version: '0.4.0', installMethod: 'npx' as const, events: { append: () => undefined } as never, log: { info() {}, warn() {}, error() {} } };
    const higher = wireUpdateCheck({ fetch: registry({ npm: { latest: '0.5.0' }, github: release('0.6.0') }).fetch }, rest, {});
    expect((await higher.checkNow()).notice.available).toEqual({ version: '0.6.0', tag: 'latest', source: 'github-releases' });
    const tie = wireUpdateCheck({ fetch: registry({ npm: { latest: '0.5.0' }, github: release('0.5.0') }).fetch }, rest, {});
    expect((await tie.checkNow()).notice.available).toEqual({ version: '0.5.0', tag: 'latest', source: 'npm' });
    // npm failing (its real state today is a 0.0.0 placeholder) doesn't hide GitHub's release.
    const onlyGitHub = wireUpdateCheck({ fetch: registry({ github: release('0.5.0') }).fetch }, rest, {});
    const result = await onlyGitHub.checkNow();
    expect(result.outcome).toBe('newer');
    expect(result.notice.available?.source).toBe('github-releases');
  });

  it('treats no published release as nothing newer, and a partial failure as failed, keeping the earlier offer', async () => {
    const rest = { dataDir: tempDataDir(), version: '0.4.0', installMethod: 'github' as const, events: { append: () => undefined } as never, log: { info() {}, warn() {}, error() {} } };
    const none = wireUpdateCheck({ fetch: registry({ github: new Response('{}', { status: 404 }) }).fetch }, rest, {});
    expect((await none.checkNow()).outcome).toBe('current');

    let phase: 'up' | 'down' = 'up';
    const flaky: UpdateFetch = async (url, init) => (phase === 'up' ? registry({ github: release('0.6.0') }).fetch(url, init) : new Response('limited', { status: 403 }));
    const check = wireUpdateCheck({ fetch: flaky }, { ...rest, dataDir: tempDataDir() }, {});
    expect((await check.checkNow()).outcome).toBe('newer');
    phase = 'down';
    const again = await check.checkNow();
    expect(again.outcome).toBe('failed');
    expect(again.notice.available?.version).toBe('0.6.0');
  });

  it('reports nothing when the sources have the same or an older version', async () => {
    const world = registry({ npm: { latest: VERSION, next: VERSION }, github: release(VERSION) });
    const server = await startTestServer({ updates: { fetch: world.fetch } });
    const tab = await signIn(server);
    await waitFor(async () => (await noticeOf(server, tab.headers)).lastCheckedAt !== null, 'the check to finish');
    expect((await noticeOf(server, tab.headers)).available).toBeNull();
  });

  it('makes no request at start when the switch is off, and the switch is kept', async () => {
    const world = registry({ npm: { latest: NEWER }, github: release(NEWER) });
    const server = await startTestServer({ updates: { fetch: world.fetch } });
    const tab = await signIn(server);
    await waitFor(() => world.calls.length === 2, 'the start check');
    const off = await send(server, API_ROUTES.updates, putEnabled(tab, false));
    expect(UpdateNoticeResponse.parse(off.json()).enabled).toBe(false);
    expect((await noticeOf(server, tab.headers)).enabled).toBe(false);
    await server.close();

    const again = registry({ npm: { latest: NEWER }, github: release(NEWER) });
    const restarted = await startTestServer({ dataDir: server.dataDir, updates: { fetch: again.fetch } });
    const tab2 = await signIn(restarted);
    expect((await noticeOf(restarted, tab2.headers)).enabled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(again.calls).toHaveLength(0);
    // Check now is the user asking, so it still goes through.
    const checked = UpdateCheckResponse.parse((await send(restarted, API_ROUTES.updatesCheck, { method: 'POST', headers: tab2.headers })).json());
    expect(checked.outcome).toBe('newer');
    expect(again.calls).toHaveLength(2);
  });

  it('appends one event when a check finishes and one when the switch changes', async () => {
    const world = registry({ npm: { latest: NEWER }, github: release(NEWER) });
    const server = await startTestServer({ updates: { fetch: world.fetch } });
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

  it('stays silent when the sources are unreachable, answer badly, or send too much, and Check now says failed', async () => {
    const bad: Array<[Answer, Answer]> = [
      [() => Promise.reject(new Error('ENOTFOUND')), () => Promise.reject(new Error('ENOTFOUND'))],
      [new Response('nope', { status: 503 }), new Response('nope', { status: 503 })],
      [new Response('not json'), new Response('not json')],
      [{ latest: 5 }, Response.json('not a list')],
      [new Response('x'.repeat(MAX_BODY_BYTES + 1)), new Response('x'.repeat(GITHUB_MAX_BODY_BYTES + 1))],
      // A redirect is never followed: the client is told to fail on one.
      [() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: 'unexpected redirect' })), new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })],
    ];
    for (const [npm, github] of bad) {
      const world = registry({ npm, github });
      const lines: string[] = [];
      const server = await startTestServer({ lines, updates: { fetch: world.fetch } });
      const tab = await signIn(server);
      await waitFor(() => world.calls.length === 2, 'the start check');
      await waitFor(() => lines.join('').includes('update check did not finish'), 'the quiet log line');
      const notice = await noticeOf(server, tab.headers);
      expect(notice.available).toBeNull();
      expect(notice.lastCheckedAt).toBeNull();
      expect(lines.join('')).not.toContain('"level":"error"');
      expect(lines.join('')).not.toContain('evil.example');
      const manual = UpdateCheckResponse.parse((await send(server, API_ROUTES.updatesCheck, { method: 'POST', headers: tab.headers })).json());
      expect(manual.outcome).toBe('failed');
      await server.close();
    }
  });

  it('accepts a GitHub answer bigger than npm\'s cap, since a release lists its files', async () => {
    const files = Array.from({ length: 12 }, (_, index) => ({ name: `file-${index}.zip`, url: `https://api.github.com/repos/hsmith-dev/ogden-agents/releases/assets/${index}`, size: 1, padding: 'p'.repeat(1500) }));
    const big = release(NEWER, { assets: files });
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_BODY_BYTES);
    const check = wireUpdateCheck({ fetch: registry({ github: big }).fetch }, { dataDir: tempDataDir(), version: '0.4.0', installMethod: 'github', events: { append: () => undefined } as never, log: { info() {}, warn() {}, error() {} } }, {});
    expect((await check.checkNow()).outcome).toBe('newer');
  });

  it('gives up on a slow source and never delays the page', async () => {
    const world = registry({ npm: () => new Promise<Response>(() => {}), github: () => new Promise<Response>(() => {}) }); // never answers
    const slow: UpdateFetch = (url, init) =>
      new Promise((resolve, reject) => {
        void world.fetch(url, init).then(resolve, reject);
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
      expect(real.mock.calls.filter(([url]) => /registry\.npmjs\.org|api\.github\.com/.test(String(url)))).toHaveLength(0);
    } finally {
      real.mockRestore();
    }
  });
});

describe('wireUpdateCheck, offline and install method', () => {
  const rest = (dataDir: string) => ({ dataDir, version: '0.4.0', installMethod: 'npx' as const, events: { append: () => undefined } as never, log: { info() {}, warn() {}, error() {} } });

  it('OGDEN_AGENTS_OFFLINE stops every request, Check now included', async () => {
    const npm = registry({ npm: { latest: '0.5.0' }, github: release('0.5.0') });
    const dataDir = tempDataDir();
    const check = wireUpdateCheck({ fetch: npm.fetch }, rest(dataDir), { OGDEN_AGENTS_OFFLINE: '1' });
    await check.runOnStart();
    expect((await check.checkNow()).outcome).toBe('offline');
    expect(check.notice().offline).toBe(true);
    expect(npm.calls).toHaveLength(0);
  });

  it('runs the start check only once', async () => {
    const npm = registry({ npm: { latest: '0.5.0' } });
    const dataDir = tempDataDir();
    const check = wireUpdateCheck({ fetch: npm.fetch }, rest(dataDir), {});
    await check.runOnStart();
    await check.runOnStart();
    expect(npm.calls).toHaveLength(2);
    expect(check.notice().available).toEqual({ version: '0.5.0', tag: 'latest', source: 'npm' });
  });

  it('reads OGDEN_AGENTS_OFFLINE as on for any value but empty, 0 or false', () => {
    expect([undefined, '', '0', 'false', ' FALSE '].map((value) => isOffline({ OGDEN_AGENTS_OFFLINE: value }))).toEqual([false, false, false, false, false]);
    expect(['1', 'true', 'yes'].map((value) => isOffline({ OGDEN_AGENTS_OFFLINE: value }))).toEqual([true, true, true]);
  });

  it('asks npm only when the install did not come from GitHub', () => {
    expect(sourcesFor('github')).toEqual(['github-releases']);
    expect(sourcesFor('npx')).toEqual(['github-releases', 'npm']);
    expect(sourcesFor('other')).toEqual(['github-releases', 'npm']);
  });

  it('tells npx from a global install from the launcher path', () => {
    expect(installMethodOf('/home/me/.npm/_npx/abc123/node_modules/ogden-agents/bin/ogden.js')).toBe('npx');
    expect(installMethodOf('C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\1a\\node_modules\\ogden-agents\\bin\\ogden.js')).toBe('npx');
    expect(installMethodOf('/usr/lib/node_modules/ogden-agents/bin/ogden.js')).toBe('global');
    expect(installMethodOf(GITHUB_LAUNCHER)).toBe('github');
    expect(installMethodOf('C:\\Users\\me\\AppData\\Local\\ogden-agents-install\\versions\\0.5.0-rc.1\\node_modules\\ogden-agents\\bin\\ogden.js')).toBe('github');
    expect(installMethodOf('/work/ogden-agents/bin/ogden.js')).toBe('other');
    expect(installMethodOf(undefined)).toBe('other');
  });
});
