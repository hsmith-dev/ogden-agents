/**
 * The app-shortcut routes (story 2.4) against a real server: every row of
 * the story's I/O matrix, on the in-memory stub, or on the `shortcut-os`
 * adapter writing into temp folders only (never the real home folder), each
 * behind the gate (AD-15).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryAppShortcut, createOsAppShortcut, DESKTOP_FILE_NAME, MACOS_APP_NAME, ShortcutRefusal } from '@ogden-agents/adapters';
import { API_ROUTES, ApiErrorBody, AppShortcutStatus } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { send, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const status = async (server: TestServer, tab: SignedIn) => {
  const reply = await send(server, API_ROUTES.appShortcut, { headers: tab.headers });
  expect(reply.status).toBe(200);
  return AppShortcutStatus.parse(reply.json());
};

const errorOf = (reply: { json: () => unknown }) => ApiErrorBody.parse(reply.json()).error;

/** A `shortcut-os` adapter for `platform` whose every folder is a fresh temp folder (`null`: no launcher). */
function tempOsShortcut(platform: string, launcherEntry: string | null = '/opt/ogden agents/bin/ogden.js', dirs = { home: tempDataDir(), state: tempDataDir() }) {
  return {
    dirs,
    shortcut: createOsAppShortcut({
      platform,
      launcherEntry: launcherEntry ?? undefined,
      nodePath: '/opt/node/bin/node',
      stateDir: dirs.state,
      homeDir: dirs.home,
      xdgDataHome: join(dirs.home, 'xdg'),
      programsDir: join(dirs.home, 'Programs'),
      runPowerShell: async () => '',
    }),
  };
}

describe('the app shortcut routes', () => {
  it('report the status with the offer pending on a first run, then Add installs it and answers the offer', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines, appShortcut: createMemoryAppShortcut({ platform: 'darwin' }) });
    const tab = await signIn(server);
    expect(await status(server, tab)).toEqual({ platform: 'darwin', supported: true, installed: false, offerPending: true });

    const added = await send(server, API_ROUTES.appShortcut, { method: 'POST', headers: tab.headers });
    expect(added.status).toBe(201);
    expect(AppShortcutStatus.parse(added.json())).toEqual({ platform: 'darwin', supported: true, installed: true, offerPending: false });
    // Adding again replaces it in place.
    const again = await send(server, API_ROUTES.appShortcut, { method: 'POST', headers: tab.headers });
    expect(again.status).toBe(201);

    const removed = await send(server, API_ROUTES.appShortcut, { method: 'DELETE', headers: tab.headers });
    expect(removed.status).toBe(204);
    // The offer was answered by Add: it stays gone after a Remove.
    expect(await status(server, tab)).toEqual({ platform: 'darwin', supported: true, installed: false, offerPending: false });
    // Removing a missing one is fine.
    expect((await send(server, API_ROUTES.appShortcut, { method: 'DELETE', headers: tab.headers })).status).toBe(204);
    expect(lines.join('')).toContain('app shortcut added');
  });

  it('answer 422 shortcut_unsupported on another OS, with no offer', async () => {
    const server = await startTestServer({ appShortcut: createMemoryAppShortcut({ platform: 'aix', supported: false }) });
    const tab = await signIn(server);
    expect(await status(server, tab)).toEqual({ platform: 'aix', supported: false, installed: false, offerPending: false });
    const added = await send(server, API_ROUTES.appShortcut, { method: 'POST', headers: tab.headers });
    expect(added.status).toBe(422);
    expect(errorOf(added)).toEqual({ code: 'shortcut_unsupported', message: expect.stringContaining("can't be added") });
  });

  it('answer 422 when the server has no launcher to point at, or runs on an unsupported OS', async () => {
    for (const { shortcut } of [tempOsShortcut('linux', null), tempOsShortcut('sunos')]) {
      const server = await startTestServer({ appShortcut: shortcut });
      const tab = await signIn(server);
      expect((await status(server, tab)).supported).toBe(false);
      const added = await send(server, API_ROUTES.appShortcut, { method: 'POST', headers: tab.headers });
      expect(added.status).toBe(422);
      expect(errorOf(added).code).toBe('shortcut_unsupported');
    }
  });

  it('Not now dismisses the offer, and that survives a restart', async () => {
    const { shortcut, dirs } = tempOsShortcut('linux');
    const server = await startTestServer({ appShortcut: shortcut, dataDir: dirs.state });
    const tab = await signIn(server);
    expect((await status(server, tab)).offerPending).toBe(true);
    expect((await send(server, API_ROUTES.appShortcutOffer, { method: 'DELETE', headers: tab.headers })).status).toBe(204);
    expect((await status(server, tab)).offerPending).toBe(false);
    await server.close();

    const restarted = await startTestServer({ appShortcut: tempOsShortcut('linux', '/opt/ogden agents/bin/ogden.js', dirs).shortcut, dataDir: dirs.state });
    const again = await status(restarted, await signIn(restarted));
    expect(again).toMatchObject({ supported: true, installed: false, offerPending: false });
  });

  it('refuse a foreign Ogden Agents.app with 422 and delete nothing, logging no path', async () => {
    const lines: string[] = [];
    const { shortcut, dirs } = tempOsShortcut('darwin');
    const app = join(dirs.home, 'Applications', MACOS_APP_NAME);
    mkdirSync(join(app, 'Contents'), { recursive: true });
    const plist = '<plist><dict><key>CFBundleIdentifier</key><string>com.example.other</string></dict></plist>';
    writeFileSync(join(app, 'Contents', 'Info.plist'), plist);
    const server = await startTestServer({ lines, appShortcut: shortcut });
    const tab = await signIn(server);
    expect((await status(server, tab)).installed).toBe(false);

    for (const method of ['POST', 'DELETE']) {
      const reply = await send(server, API_ROUTES.appShortcut, { method, headers: tab.headers });
      expect(reply.status, method).toBe(422);
      expect(errorOf(reply).code).toBe('shortcut_unsupported');
      expect(errorOf(reply).message).not.toContain(dirs.home);
    }
    expect(readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8')).toBe(plist);
    expect(lines.join('')).toContain('the app shortcut could not be added');
    expect(lines.join('')).not.toContain(dirs.home);
  });

  it('re-point an installed shortcut at the current launcher when the server starts, and never create one', async () => {
    const dirs = { home: tempDataDir(), state: tempDataDir() };
    const desktop = join(dirs.home, 'xdg', 'applications', DESKTOP_FILE_NAME);

    // Not installed: a start creates nothing.
    const fresh = await startTestServer({ appShortcut: tempOsShortcut('linux', '/new/bin/ogden.js', dirs).shortcut });
    await fresh.close();
    expect(() => readFileSync(desktop)).toThrow();

    await tempOsShortcut('linux', '/old/bin/ogden.js', dirs).shortcut.add();
    expect(readFileSync(desktop, 'utf8')).toContain('/old/bin/ogden.js');
    await startTestServer({ appShortcut: tempOsShortcut('linux', '/new/bin/ogden.js', dirs).shortcut });
    await waitFor(() => readFileSync(desktop, 'utf8').includes('/new/bin/ogden.js'), 'the shortcut to be re-pointed');
  });

  it('log a failed re-point without the path, and keep running', async () => {
    const lines: string[] = [];
    const failing = createMemoryAppShortcut({ installed: true });
    failing.add = async () => {
      throw Object.assign(new Error('EACCES: permission denied, open /Users/someone/Applications'), { code: 'EACCES' });
    };
    const server = await startTestServer({ lines, appShortcut: failing });
    await waitFor(() => lines.join('').includes('could not re-point the app shortcut'), 'the failure to be logged');
    expect(lines.join('')).toContain('EACCES');
    expect(lines.join('')).not.toContain('/Users/someone');
    expect((await status(server, await signIn(server))).installed).toBe(true);
  });

  it('never answer 500 when the offer answer cannot be saved: Add still succeeds, Not now is 422, and no path is logged', async () => {
    const lines: string[] = [];
    const shortcut = createMemoryAppShortcut({ platform: 'linux' });
    shortcut.dismissOffer = async () => {
      throw new ShortcutRefusal("Ogden Agents couldn't save your answer. Try again.", {
        cause: Object.assign(new Error('EACCES: permission denied, open /home/someone/data/app-shortcut.json'), { code: 'EACCES' }),
      });
    };
    const server = await startTestServer({ lines, appShortcut: shortcut });
    const tab = await signIn(server);
    const dismissed = await send(server, API_ROUTES.appShortcutOffer, { method: 'DELETE', headers: tab.headers });
    expect(dismissed.status).toBe(422);
    expect(errorOf(dismissed)).toEqual({ code: 'shortcut_unsupported', message: "Ogden Agents couldn't save your answer. Try again." });
    const added = await send(server, API_ROUTES.appShortcut, { method: 'POST', headers: tab.headers });
    expect(added.status).toBe(201);
    expect(AppShortcutStatus.parse(added.json()).installed).toBe(true);
    expect(lines.join('')).toContain('EACCES');
    expect(lines.join('')).not.toContain('/home/someone');
  });

  it('are behind the gate: 401 without a token, 403 from a foreign Origin when they change state', async () => {
    const server = await startTestServer({ appShortcut: createMemoryAppShortcut() });
    const tab = await signIn(server);
    const routes: Array<[string, string]> = [
      ['GET', API_ROUTES.appShortcut],
      ['POST', API_ROUTES.appShortcut],
      ['DELETE', API_ROUTES.appShortcut],
      ['DELETE', API_ROUTES.appShortcutOffer],
    ];
    for (const [method, path] of routes) {
      const anonymous = await send(server, path, { method, headers: { origin: server.url } });
      expect(anonymous.status, `${method} ${path} without a token`).toBe(401);
      if (method !== 'GET') {
        const foreign = await send(server, path, { method, headers: { ...tab.headers, origin: 'http://evil.example' } });
        expect(foreign.status, `${method} ${path} from a foreign Origin`).toBe(403);
      }
    }
    // Nothing changed.
    expect(await status(server, tab)).toMatchObject({ installed: false, offerPending: true });
  });
});
