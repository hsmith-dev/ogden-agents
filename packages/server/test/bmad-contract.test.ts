/**
 * The per-project BMad pieces contract over REST (CAP-19, AD-22; story 10.2):
 * what the install ships (`GET` pieces, nothing by default, a test's own by
 * option or hook), core refusing to turn on an unavailable piece and a
 * broken dependency rule, the one route helper that applies core's guard,
 * and the pre-registered 501 stubs that never read the body.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeatureOffError, openCore, type Core } from '@ogden-agents/core';
import {
  API_BASE,
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  BMAD_COMING_SOON_REASON,
  BMAD_PIECES,
  BmadPiecesResponse,
  FEATURE_OFF_MESSAGE,
  FEATURE_UNAVAILABLE_MESSAGE,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
} from '@ogden-agents/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bmadPieceRoutes, guardedRouteKeys, SHIPPED_BMAD_PIECES } from '../src/bmad-pieces.js';
import { registerBmadRoutes } from '../src/bmad-routes.js';
import { createLogger } from '../src/log.js';
import { BMAD_AVAILABLE_ENV } from '../src/test-hooks.js';
import { send, signIn, startTestServer, tempDataDir, type SignedIn, type TestServer } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const repos: string[] = [];
const cores: Core[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const core of cores.splice(0)) core.close();
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function tempRepo(): string {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  repos.push(repo);
  return repo;
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function addProject(server: TestServer, tab: SignedIn) {
  return WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: tempRepo() })).json()).workspace;
}

const settingsPath = (wsId: string) => apiPath(API_ROUTES.workspaceSettings, { wsId });

async function piecesOf(server: TestServer, tab: SignedIn) {
  const reply = await request(server, tab, 'GET', API_ROUTES.bmadPieces);
  expect(reply.status).toBe(200);
  return BmadPiecesResponse.parse(await reply.json()).pieces;
}

async function refusalOf(reply: Response) {
  return { status: reply.status, ...ApiErrorBody.parse(await reply.json()).error };
}

describe('what the install ships (story 10.2)', () => {
  it('ships no piece yet: all four are coming soon, and no PATCH can turn one on', async () => {
    expect(SHIPPED_BMAD_PIECES).toEqual([]);
    const server = await startTestServer();
    const tab = await signIn(server);
    expect(await piecesOf(server, tab)).toEqual(BMAD_PIECES.map((piece) => ({ piece, available: false, reason: BMAD_COMING_SOON_REASON })));

    const workspace = await addProject(server, tab);
    const before = server.core.events.lastSeq();
    for (const bmadPieces of [['planning'], ['board'], ['board', 'builds'], ['planning', 'board', 'builds', 'retrospectives']]) {
      const refused = await refusalOf(await request(server, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces, cautionLevel: 'ask_for_commands' }));
      expect(refused, JSON.stringify(bmadPieces)).toEqual({ status: 409, code: 'feature_unavailable', message: FEATURE_UNAVAILABLE_MESSAGE });
    }
    expect(server.core.events.lastSeq()).toBe(before);
    expect(WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', settingsPath(workspace.id))).json()).settings).toEqual({
      cautionLevel: 'ask_every_time',
      bmadPieces: [],
    });
    // Behind the gate like every API route.
    expect((await send(server, API_ROUTES.bmadPieces)).status).toBe(401);
  });

  it('a test-registered piece, by start() option or by its test hook, is available with no reason, and the hook is logged', async () => {
    const byOption = await startTestServer({ availableBmadPieces: ['planning'] });
    const pieces = await piecesOf(byOption, await signIn(byOption));
    expect(pieces[0]).toEqual({ piece: 'planning', available: true });
    expect(pieces.slice(1).map((entry) => entry.available)).toEqual([false, false, false]);
    await byOption.close();

    vi.stubEnv(BMAD_AVAILABLE_ENV, 'board, planning');
    const lines: string[] = [];
    const byHook = await startTestServer({ lines });
    expect((await piecesOf(byHook, await signIn(byHook))).map((entry) => entry.available)).toEqual([true, true, false, false]);
    const hooks = lines.map((line) => JSON.parse(line) as { msg: string; bmadAvailable?: string }).find((line) => line.msg === 'test hooks in use');
    expect(hooks?.bmadAvailable).toBe('board,planning');
  });

  it('refuses a broken dependency rule with invalid_request even when every piece is available, storing nothing', async () => {
    const server = await startTestServer({ availableBmadPieces: BMAD_PIECES });
    const tab = await signIn(server);
    const workspace = await addProject(server, tab);
    const before = server.core.events.lastSeq();
    for (const bmadPieces of [['builds'], ['retrospectives'], ['board', 'retrospectives']]) {
      const refused = await refusalOf(await request(server, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces }));
      expect(refused.status, JSON.stringify(bmadPieces)).toBe(400);
      expect(refused.code).toBe('invalid_request');
      expect(refused.message).toMatch(/needs/);
    }
    expect(server.core.events.lastSeq()).toBe(before);
    const ok = await request(server, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces: ['retrospectives', 'board', 'builds'] });
    expect(WorkspaceSettingsResponse.parse(await ok.json()).settings.bmadPieces).toEqual(['board', 'builds', 'retrospectives']);
  });

  it('keeps a stored piece that is no longer available when only the caution level changes, and lets it be turned off', async () => {
    const dataDir = tempDataDir();
    const first = await startTestServer({ dataDir, availableBmadPieces: ['planning'] });
    const firstTab = await signIn(first);
    const workspace = await addProject(first, firstTab);
    expect((await request(first, firstTab, 'PATCH', settingsPath(workspace.id), { bmadPieces: ['planning'] })).status).toBe(200);
    await first.close();

    const second = await startTestServer({ dataDir });
    const tab = await signIn(second);
    const caution = await request(second, tab, 'PATCH', settingsPath(workspace.id), { cautionLevel: 'ask_for_commands' });
    expect(caution.status).toBe(200);
    expect(WorkspaceSettingsResponse.parse(await caution.json()).settings).toEqual({ cautionLevel: 'ask_for_commands', bmadPieces: ['planning'] });
    const off = await request(second, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces: [] });
    expect(WorkspaceSettingsResponse.parse(await off.json()).settings.bmadPieces).toEqual([]);
    expect((await refusalOf(await request(second, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces: ['planning'] }))).code).toBe('feature_unavailable');
  });
});

describe('bmadPieceRoutes, the one helper (story 10.2)', () => {
  /** A bare app on a core with every piece available, a workspace in it, and guarded routes that record their runs. */
  function guardedApp() {
    const core = openCore(tempDataDir(), { availableBmadPieces: BMAD_PIECES });
    cores.push(core);
    const workspace = core.entities.ensureWorkspace(tempRepo());
    const app = new Hono();
    const runs: string[] = [];
    const routes = bmadPieceRoutes(app, { bmad: core.bmad, log: createLogger(() => {}) });
    const path = `${API_BASE}/workspaces/:wsId/test/board`;
    routes.get('board', path, (c, { workspaceId }) => {
      runs.push(`GET ${workspaceId}`);
      return c.json({ workspaceId });
    });
    routes.post('board', path, async (c) => {
      runs.push(`POST ${await c.req.text()}`);
      return c.body(null, 204);
    });
    // A handler whose own core use-case refuses: answered the same way as the guard's refusal.
    routes.put('planning', path, () => {
      throw new FeatureOffError('planning');
    });
    return { core, workspace, app, runs, url: (wsId: string) => apiPath(path, { wsId }) };
  }

  it('refuses with feature_off while the piece is off, without running the handler or reading the body; runs it once on', async () => {
    const { core, workspace, app, runs, url } = guardedApp();
    const off = await app.request(url(workspace.id), { method: 'POST', body: 'secret-body' });
    expect(await refusalOf(off)).toEqual({ status: 409, code: 'feature_off', message: FEATURE_OFF_MESSAGE });
    expect(runs).toEqual([]);

    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    const on = await app.request(url(workspace.id));
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ workspaceId: workspace.id });
    expect((await app.request(url(workspace.id), { method: 'POST', body: 'hello' })).status).toBe(204);
    expect(runs).toEqual([`GET ${workspace.id}`, 'POST hello']);

    // Turned off in another request: the very next call is refused (the guard is read at each call).
    core.permissions.updateSettings(workspace.id, { bmadPieces: [] });
    expect((await refusalOf(await app.request(url(workspace.id)))).code).toBe('feature_off');
    expect(runs).toHaveLength(2);
  });

  it('answers not_found for an unknown or malformed workspace without running the handler', async () => {
    const { app, runs, url } = guardedApp();
    for (const wsId of [UNKNOWN, 'not-a-workspace', 'ws_bad']) {
      expect(await refusalOf(await app.request(url(wsId))), wsId).toMatchObject({ status: 404, code: 'not_found' });
    }
    expect(runs).toEqual([]);
  });

  it("maps a handler's own core refusals the same way", async () => {
    const { core, workspace, app, url } = guardedApp();
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    expect(await refusalOf(await app.request(url(workspace.id), { method: 'PUT' }))).toMatchObject({ status: 409, code: 'feature_off' });
  });

  it('throws at registration for a path outside a workspace, and lists what it registered', () => {
    const { core, app } = guardedApp();
    const routes = bmadPieceRoutes(app, { bmad: core.bmad, log: createLogger(() => {}) });
    for (const path of [`${API_BASE}/bmad/thing`, '/workspaces/:wsId/thing', `${API_BASE}/workspaces/:id/thing`, `${API_BASE}/workspaces/:wsId`]) {
      expect(() => routes.get('board', path, (c) => c.body(null, 204)), path).toThrow(/inside a workspace/);
    }
    routes.delete('retrospectives', `${API_BASE}/workspaces/:wsId/test/retro`, (c) => c.body(null, 204));
    expect(guardedRouteKeys(app)).toEqual([
      `DELETE ${API_BASE}/workspaces/:wsId/test/retro`,
      `GET ${API_BASE}/workspaces/:wsId/test/board`,
      `POST ${API_BASE}/workspaces/:wsId/test/board`,
      `PUT ${API_BASE}/workspaces/:wsId/test/board`,
    ]);
    expect(guardedRouteKeys(new Hono())).toEqual([]);
  });
});

describe('the pre-registered BMad routes (story 10.2)', () => {
  it('the new-projects default answers 501 and never reads the body; pieces answers 501 without core', async () => {
    const lines: string[] = [];
    const app = new Hono();
    registerBmadRoutes(app, { log: createLogger((line) => lines.push(line)) });
    const secret = 'never-read-0123456789';
    const calls: Array<[string, string, string | undefined]> = [
      ['GET', API_ROUTES.bmadPieces, undefined],
      ['GET', API_ROUTES.newProjectDefaults, undefined],
      ['PATCH', API_ROUTES.newProjectDefaults, JSON.stringify({ bmadPieces: [secret] })],
      ['PATCH', API_ROUTES.newProjectDefaults, '{nope'],
    ];
    for (const [method, path, body] of calls) {
      const reply = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body }) });
      expect(await refusalOf(reply), `${method} ${path}`).toMatchObject({ status: 501, code: 'not_implemented' });
    }
    expect(lines.join('')).not.toContain(secret);
  });

  it('are behind the gate on a real server', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    for (const [method, path] of [
      ['GET', API_ROUTES.newProjectDefaults],
      ['PATCH', API_ROUTES.newProjectDefaults],
    ] as const) {
      expect((await send(server, path, { method })).status, `${method} ${path}`).toBe(401);
      expect((await refusalOf(await request(server, tab, method, path, method === 'PATCH' ? { bmadPieces: [] } : undefined))).status, `${method} ${path}`).toBe(501);
    }
  });
});
