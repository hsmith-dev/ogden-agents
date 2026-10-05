/**
 * The desktop app's update contract (story 13.3, E13-R3, E13-R4, E13-R6): the
 * shell's launcher calls need the launcher token and shell mode, the page's
 * Restart is refused while anything is busy, the poll hands the go-ahead over
 * once, downgrades are refused, the events validate, and shell mode turns the
 * npm check off. No real shell, network or agent runs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_ROUTES, AppUpdateAvailableEvent, AppUpdateRequestedEvent, UpdateNoticeResponse, type CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { LAUNCHER_TOKEN_HEADER, readLauncherToken } from '../src/launcher-token.js';
import { shellModeOf, watchParent } from '../src/shell-mode.js';
import { createBusyRule } from '../src/update-notice/busy-rule.js';
import { DESKTOP_UPDATE_FILE } from '../src/update-notice/desktop-update.js';
import { LAUNCHER_APP_UPDATE, LAUNCHER_UPDATE_CHANNEL } from '../src/update-notice/routes.js';
import { VERSION } from '../src/version.js';
import { send, signIn, startTestServer, tempDataDir, waitFor, type TestServer } from './helpers.js';

const bump = (version: string, by = 1): string => {
  const [major, minor, patch] = version.split('-')[0]!.split('.').map(Number) as [number, number, number];
  return `${major}.${minor}.${patch + by}`;
};
const NEWER = bump(VERSION);
const json = (headers: Record<string, string>) => ({ ...headers, 'content-type': 'application/json' });
const launcher = (server: TestServer) => ({ [LAUNCHER_TOKEN_HEADER]: readLauncherToken(server.dataDir)! });
const report = (version = NEWER, downloaded = true) => JSON.stringify({ version, notes: 'Faster starts.', channel: 'stable', downloaded });

async function noticeOf(server: TestServer, headers: Record<string, string>) {
  return UpdateNoticeResponse.parse((await send(server, API_ROUTES.updates, { headers })).json());
}
const events = (server: TestServer): CoreEvent[] => server.core.events.readAfter(0);

describe('shell mode', () => {
  it('is on only for exactly OGDEN_AGENTS_SHELL=desktop', () => {
    expect(shellModeOf({ OGDEN_AGENTS_SHELL: 'desktop' })).toBe('desktop');
    for (const value of [undefined, '', 'Desktop', 'desktop ', '1', 'true']) expect(shellModeOf({ OGDEN_AGENTS_SHELL: value })).toBeNull();
    expect(shellModeOf({})).toBeNull();
  });

  it('the parent watch fires once when the pipe ends or closes, and starts the stream flowing', () => {
    const listeners: Record<string, Array<() => void>> = {};
    let resumed = 0;
    let gone = 0;
    watchParent(
      { once: (event, listener) => ((listeners[event] ??= []).push(listener), undefined), resume: () => void resumed++ },
      () => void gone++,
    );
    expect(resumed).toBe(1);
    listeners.end![0]!();
    listeners.close![0]!();
    expect(gone).toBe(1);
  });
});

describe('the busy rule', () => {
  it('is busy while sessions work or a registered source counts running work, and a source can be removed', () => {
    let sessions = 0;
    let builds = 0;
    const rule = createBusyRule(() => sessions);
    expect(rule()).toEqual({ busy: false, busySessions: 0, total: 0 });
    sessions = 2;
    expect(rule()).toEqual({ busy: true, busySessions: 2, total: 2 });
    sessions = 0;
    const remove = rule.register(() => builds);
    expect(rule().busy).toBe(false);
    builds = 1;
    expect(rule()).toEqual({ busy: true, busySessions: 0, total: 1 });
    remove();
    expect(rule().busy).toBe(false);
  });
});

describe('the shell calls (launcher token, shell mode only)', () => {
  it('refuse without the launcher token, with a tab token instead, and answer 404 outside shell mode', async () => {
    const server = await startTestServer({ shell: 'desktop', updates: false });
    const tab = await signIn(server);
    for (const [method, path] of [['POST', LAUNCHER_APP_UPDATE], ['GET', LAUNCHER_APP_UPDATE], ['GET', LAUNCHER_UPDATE_CHANNEL]] as const) {
      expect((await send(server, path, { method, body: method === 'POST' ? report() : undefined })).status).toBe(401);
      // A tab's own token is not the launcher's: the handshake prefix never takes it.
      expect((await send(server, path, { method, headers: tab.headers, body: method === 'POST' ? report() : undefined })).status).toBe(401);
    }
    const plain = await startTestServer({ shell: null, updates: false });
    const reply = await send(plain, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(plain)), body: report() });
    expect(reply.status).toBe(404);
    expect((await send(plain, LAUNCHER_UPDATE_CHANNEL, { headers: launcher(plain) })).status).toBe(404);
  });

  it('report an update the page then sees, once, with the event; a version that is not newer is refused', async () => {
    const server = await startTestServer({ shell: 'desktop', updates: false });
    const tab = await signIn(server);
    expect((await noticeOf(server, tab.headers)).app).toBeNull();
    expect((await noticeOf(server, tab.headers)).shell).toBe('desktop');

    for (const stale of [VERSION, '0.0.1']) {
      const refused = await send(server, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(server)), body: report(stale) });
      expect(refused.status).toBe(409);
    }
    expect((await send(server, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(server)), body: report(NEWER, false) })).status).toBe(204);
    let notice = await noticeOf(server, tab.headers);
    expect(notice.app).toMatchObject({ update: { version: NEWER, downloaded: false, channel: 'stable' }, blocked: false, restartRequested: false });

    expect((await send(server, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(server)), body: report() })).status).toBe(204);
    notice = await noticeOf(server, tab.headers);
    expect(notice.app?.update.downloaded).toBe(true);
    const available = events(server).filter((event) => event.type === 'app.update_available');
    expect(available.length).toBeGreaterThanOrEqual(2);
    for (const event of available) expect(AppUpdateAvailableEvent.safeParse(event).success).toBe(true);
  });

  it('reject bad and oversized bodies', async () => {
    const server = await startTestServer({ shell: 'desktop', updates: false });
    const bad = await send(server, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(server)), body: '{"version":"1.0.0"}' });
    expect(bad.status).toBe(400);
    const big = await send(server, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(server)), body: JSON.stringify({ version: NEWER, notes: 'x'.repeat(100_000), channel: 'stable', downloaded: true }) });
    expect(big.status).toBe(413);
  });
});

describe('Restart to update', () => {
  const restart = (server: TestServer, headers: Record<string, string>, whenIdle?: boolean) =>
    send(server, API_ROUTES.updatesAppRestart, { method: 'POST', headers: json(headers), body: whenIdle === undefined ? '' : JSON.stringify({ whenIdle }) });
  const poll = async (server: TestServer) => ((await send(server, LAUNCHER_APP_UPDATE, { headers: launcher(server) })).json() as { restart: boolean }).restart;

  it('is refused with no update, and while it is still downloading', async () => {
    const server = await startTestServer({ shell: 'desktop', updates: false });
    const tab = await signIn(server);
    expect((await restart(server, tab.headers)).status).toBe(404);
    await send(server, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(server)), body: report(NEWER, false) });
    expect((await restart(server, tab.headers)).status).toBe(409);
    expect(await poll(server)).toBe(false);
  });

  it('goes ahead when idle: the poll says so once', async () => {
    const server = await startTestServer({ shell: 'desktop', updates: false });
    const tab = await signIn(server);
    await send(server, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(server)), body: report() });
    expect(await poll(server)).toBe(false);
    const reply = await restart(server, tab.headers);
    expect(reply.status).toBe(202);
    expect(await poll(server)).toBe(true);
    expect(await poll(server)).toBe(false);
    const requested = events(server).filter((event) => event.type === 'app.update_requested');
    expect(requested).toHaveLength(1);
    expect(AppUpdateRequestedEvent.safeParse(requested[0]).success).toBe(true);
  });

  it('never goes ahead while an agent turn is running, and waits when asked to', async () => {
    const server = await startTestServer({ shell: 'desktop', updates: false });
    const tab = await signIn(server);
    await send(server, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(server)), body: report() });
    const workspace = server.core.entities.ensureWorkspace(tempDataDir());
    const session = server.core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', state: 'working' });

    let notice = await noticeOf(server, tab.headers);
    expect(notice.app).toMatchObject({ blocked: true, busy: 1 });
    const refused = await restart(server, tab.headers);
    expect(refused.status).toBe(409);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('sessions_busy');
    expect(await poll(server)).toBe(false);

    // "Restart when they finish": accepted, but the shell is told nothing until idle.
    expect((await restart(server, tab.headers, true)).status).toBe(202);
    expect(await poll(server)).toBe(false);
    notice = await noticeOf(server, tab.headers);
    expect(notice.app).toMatchObject({ blocked: true, restartRequested: true });

    server.core.entities.setSessionState(session.id, 'idle');
    await waitFor(async () => (await noticeOf(server, tab.headers)).app?.blocked === false, 'the session to be idle');
    expect(await poll(server)).toBe(true);
  });

  it('needs the tab token and a matching Origin', async () => {
    const server = await startTestServer({ shell: 'desktop', updates: false });
    const tab = await signIn(server);
    await send(server, LAUNCHER_APP_UPDATE, { method: 'POST', headers: json(launcher(server)), body: report() });
    expect((await send(server, API_ROUTES.updatesAppRestart, { method: 'POST', headers: json({}), body: '' })).status).toBe(401);
    expect((await send(server, API_ROUTES.updatesAppRestart, { method: 'POST', headers: json({ ...tab.headers, origin: 'http://evil.example' }), body: '' })).status).toBe(403);
    expect((await send(server, API_ROUTES.updatesAppRestart, { method: 'POST', headers: json(launcher(server)), body: '' })).status).toBe(401);
  });

  it('answers 404 outside the app', async () => {
    const server = await startTestServer({ shell: null, updates: false });
    const tab = await signIn(server);
    expect((await restart(server, tab.headers)).status).toBe(404);
    expect((await send(server, API_ROUTES.updatesAppChannel, { method: 'PUT', headers: json(tab.headers), body: '{"channel":"next"}' })).status).toBe(404);
    expect((await noticeOf(server, tab.headers))).toMatchObject({ shell: null, app: null, appChannel: null });
  });
});

describe('the update channel', () => {
  it('defaults from the running version, is kept in the data folder, and the shell reads it', async () => {
    const server = await startTestServer({ shell: 'desktop', updates: false });
    const tab = await signIn(server);
    const defaultChannel = VERSION.includes('-') ? 'next' : 'stable';
    expect((await noticeOf(server, tab.headers)).appChannel).toBe(defaultChannel);
    const other = defaultChannel === 'stable' ? 'next' : 'stable';
    const saved = await send(server, API_ROUTES.updatesAppChannel, { method: 'PUT', headers: json(tab.headers), body: JSON.stringify({ channel: other }) });
    expect(saved.status).toBe(200);
    expect(JSON.parse(readFileSync(join(server.dataDir, DESKTOP_UPDATE_FILE), 'utf8'))).toEqual({ channel: other });
    expect((await send(server, LAUNCHER_UPDATE_CHANNEL, { headers: launcher(server) })).json()).toEqual({ channel: other });
    expect((await send(server, API_ROUTES.updatesAppChannel, { method: 'PUT', headers: json(tab.headers), body: '{"channel":"beta"}' })).status).toBe(400);
  });
});

describe('shell mode and the npm check', () => {
  it('never runs the npm source in shell mode, even with a client given', async () => {
    let calls = 0;
    const server = await startTestServer({ shell: 'desktop', updates: { fetch: async () => (calls++, Response.json({ latest: NEWER, next: NEWER })) } });
    const tab = await signIn(server);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toBe(0);
    expect((await noticeOf(server, tab.headers)).available).toBeNull();
  });
});

describe('the shell\'s Quit (launcher token, shell mode only)', () => {
  it('asks first when sessions are busy, stops when forced, and exists only in shell mode', async () => {
    const server = await startTestServer({ shell: 'desktop', updates: false });
    const workspace = server.core.entities.ensureWorkspace(tempDataDir());
    server.core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', state: 'working' });
    const tab = await signIn(server);

    expect((await send(server, '/launcher/quit', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await send(server, '/launcher/quit', { method: 'POST', headers: json(tab.headers), body: '{}' })).status).toBe(401);
    const busy = await send(server, '/launcher/quit', { method: 'POST', headers: json(launcher(server)), body: '{}' });
    expect(busy.status).toBe(409);
    expect(busy.json()).toMatchObject({ error: { code: 'sessions_busy', details: { busySessions: 1 } } });
    const forced = await send(server, '/launcher/quit', { method: 'POST', headers: json(launcher(server)), body: '{"force":true}' });
    expect(forced.status).toBe(202);
    await server.stopped;

    const plain = await startTestServer({ shell: null, updates: false });
    expect((await send(plain, '/launcher/quit', { method: 'POST', headers: json(launcher(plain)), body: '{}' })).status).toBe(404);
  });
});
