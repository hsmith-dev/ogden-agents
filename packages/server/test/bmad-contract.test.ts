/**
 * The per-project BMad pieces contract over REST (CAP-19, AD-22; story 10.2):
 * what the install ships (`GET` pieces: Planning and Board since story 4.2,
 * a test's own by option or hook), core refusing to turn on an unavailable
 * piece and a broken dependency rule, the one route helper that applies
 * core's guard and, for a route running project scripts, the script trust
 * (story 4.2), and the pre-registered 501 stubs that never read the body.
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
  SCRIPTS_NOT_TRUSTED_MESSAGE,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
} from '@ogden-agents/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bmadPieceRoutes, guardedRouteKeys, SHIPPED_BMAD_PIECES, trustedRouteKeys } from '../src/bmad-pieces.js';
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
  it('ships Planning, Board (story 4.2), Unattended builds (story 5.2) and Retrospectives (story 7.1)', async () => {
    expect(SHIPPED_BMAD_PIECES).toEqual(['planning', 'board', 'builds', 'retrospectives']);
    const server = await startTestServer();
    const tab = await signIn(server);
    expect(await piecesOf(server, tab)).toEqual([
      { piece: 'planning', available: true },
      { piece: 'board', available: true },
      { piece: 'builds', available: true },
      { piece: 'retrospectives', available: true },
    ]);

    const workspace = await addProject(server, tab);
    expect(WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', settingsPath(workspace.id))).json()).settings).toEqual({
      cautionLevel: 'ask_every_time',
      bmadPieces: [],
      bmadScriptsTrusted: false,
    });
    // Every shipped piece turns on (Retrospectives needs Unattended builds until story 7.2 changes it to Board).
    const on = await request(server, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces: ['planning', 'board', 'builds', 'retrospectives'] });
    expect(WorkspaceSettingsResponse.parse(await on.json()).settings.bmadPieces).toEqual(['planning', 'board', 'builds', 'retrospectives']);

    // An install that ships one piece fewer: it is coming soon, and no PATCH turns it on.
    const fewer = await startTestServer({ shippedBmadPieces: ['planning', 'board', 'builds'] });
    const fewerTab = await signIn(fewer);
    expect(await piecesOf(fewer, fewerTab)).toContainEqual({ piece: 'retrospectives', available: false, reason: BMAD_COMING_SOON_REASON });
    const other = await addProject(fewer, fewerTab);
    const before = fewer.core.events.lastSeq();
    const refused = await refusalOf(await request(fewer, fewerTab, 'PATCH', settingsPath(other.id), { bmadPieces: ['board', 'builds', 'retrospectives'] }));
    expect(refused).toEqual({ status: 409, code: 'feature_unavailable', message: FEATURE_UNAVAILABLE_MESSAGE });
    expect(fewer.core.events.lastSeq()).toBe(before);
    // Behind the gate like every API route.
    expect((await send(server, API_ROUTES.bmadPieces)).status).toBe(401);
  });

  it('a test-registered piece, by start() option or by its test hook, is available with no reason, and the hook is logged', async () => {
    const byOption = await startTestServer({ shippedBmadPieces: ['planning', 'board', 'builds'], availableBmadPieces: ['retrospectives'] });
    const pieces = await piecesOf(byOption, await signIn(byOption));
    expect(pieces[3]).toEqual({ piece: 'retrospectives', available: true });
    expect(pieces.map((entry) => entry.available)).toEqual([true, true, true, true]);
    await byOption.close();

    vi.stubEnv(BMAD_AVAILABLE_ENV, 'retrospectives, builds');
    const lines: string[] = [];
    const byHook = await startTestServer({ lines, shippedBmadPieces: ['planning', 'board', 'builds'] });
    expect((await piecesOf(byHook, await signIn(byHook))).map((entry) => entry.available)).toEqual([true, true, true, true]);
    const hooks = lines.map((line) => JSON.parse(line) as { msg: string; bmadAvailable?: string }).find((line) => line.msg === 'test hooks in use');
    expect(hooks?.bmadAvailable).toBe('retrospectives,builds');
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
});

describe('bmadPieceRoutes, the one helper (story 10.2)', () => {
  /** A bare app on a core with every piece available, a workspace in it, and guarded routes that record their runs. */
  async function guardedApp() {
    const core = openCore(tempDataDir(), { availableBmadPieces: BMAD_PIECES });
    cores.push(core);
    const workspace = core.entities.ensureWorkspace(tempRepo());
    // Board runs the project's scripts: these routes check the trust too (story 4.2), which this workspace has.
    await core.bmadScriptTrust.trustScripts(workspace.id);
    const app = new Hono();
    const runs: string[] = [];
    const routes = bmadPieceRoutes(app, { bmad: core.bmad, scriptTrust: core.bmadScriptTrust, log: createLogger(() => {}) });
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
    const { core, workspace, app, runs, url } = await guardedApp();
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
    const { app, runs, url } = await guardedApp();
    for (const wsId of [UNKNOWN, 'not-a-workspace', 'ws_bad']) {
      expect(await refusalOf(await app.request(url(wsId))), wsId).toMatchObject({ status: 404, code: 'not_found' });
    }
    expect(runs).toEqual([]);
  });

  it("maps a handler's own core refusals the same way", async () => {
    const { core, workspace, app, url } = await guardedApp();
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    expect(await refusalOf(await app.request(url(workspace.id), { method: 'PUT' }))).toMatchObject({ status: 409, code: 'feature_off' });
  });

  it('throws at registration for a path outside a workspace, and lists what it registered', async () => {
    const { core, app } = await guardedApp();
    const routes = bmadPieceRoutes(app, { bmad: core.bmad, scriptTrust: core.bmadScriptTrust, log: createLogger(() => {}) });
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
    // Board and Retrospectives run the project's scripts; Planning doesn't (story 4.2).
    expect(trustedRouteKeys(app)).toEqual([
      `DELETE ${API_BASE}/workspaces/:wsId/test/retro`,
      `GET ${API_BASE}/workspaces/:wsId/test/board`,
      `POST ${API_BASE}/workspaces/:wsId/test/board`,
    ]);
  });
});

describe('bmadPieceRoutes and the script trust (story 4.2)', () => {
  /** A bare app on a core with Planning and Board, an untrusted workspace with Board on, and routes that record their runs. */
  function trustApp() {
    const core = openCore(tempDataDir(), { availableBmadPieces: BMAD_PIECES });
    cores.push(core);
    const workspace = core.entities.ensureWorkspace(tempRepo());
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    const app = new Hono();
    const runs: string[] = [];
    const routes = bmadPieceRoutes(app, { bmad: core.bmad, scriptTrust: core.bmadScriptTrust, log: createLogger(() => {}) });
    const scripts = `${API_BASE}/workspaces/:wsId/test/scripts`;
    const either = `${API_BASE}/workspaces/:wsId/test/either`;
    routes.post('board', scripts, async (c) => {
      runs.push(`scripts ${await c.req.text()}`);
      return c.body(null, 204);
    });
    routes.get(['planning', 'board'], either, (c) => {
      runs.push('either');
      return c.body(null, 204);
    }, { projectScripts: false });
    return { core, workspace, app, runs, scripts: (wsId: string) => apiPath(scripts, { wsId }), either: (wsId: string) => apiPath(either, { wsId }) };
  }

  it('refuses scripts_not_trusted after the piece guard, without running the handler or reading the body; runs once trusted', async () => {
    const { core, workspace, app, runs, scripts } = trustApp();
    const refused = await app.request(scripts(workspace.id), { method: 'POST', body: 'secret-body' });
    expect(await refusalOf(refused)).toEqual({ status: 409, code: 'scripts_not_trusted', message: SCRIPTS_NOT_TRUSTED_MESSAGE });
    expect(runs).toEqual([]);
    // The piece guard comes first: Board off is feature_off, trusted or not.
    core.permissions.updateSettings(workspace.id, { bmadPieces: [] });
    expect((await refusalOf(await app.request(scripts(workspace.id), { method: 'POST' }))).code).toBe('feature_off');
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await core.bmadScriptTrust.trustScripts(workspace.id);
    expect((await app.request(scripts(workspace.id), { method: 'POST', body: 'hello' })).status).toBe(204);
    expect(runs).toEqual(['scripts hello']);
  });

  it('a route serving several pieces answers while any is on, and one running no project script needs no trust', async () => {
    const { core, workspace, app, runs, either } = trustApp();
    expect((await app.request(either(workspace.id))).status).toBe(204);
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    expect((await app.request(either(workspace.id))).status).toBe(204);
    core.permissions.updateSettings(workspace.id, { bmadPieces: [] });
    expect((await refusalOf(await app.request(either(workspace.id)))).code).toBe('feature_off');
    expect(runs).toEqual(['either', 'either']);
  });

  it('refuses to register a script-running route without the trust, and an empty piece list', () => {
    const core = openCore(tempDataDir(), { availableBmadPieces: BMAD_PIECES });
    cores.push(core);
    const routes = bmadPieceRoutes(new Hono(), { bmad: core.bmad, log: createLogger(() => {}) });
    expect(() => routes.get('board', `${API_BASE}/workspaces/:wsId/test/x`, (c) => c.body(null, 204))).toThrow(/script trust/);
    expect(() => routes.get(['planning', 'board'], `${API_BASE}/workspaces/:wsId/test/x`, (c) => c.body(null, 204))).toThrow(/script trust/);
    expect(() => routes.get([], `${API_BASE}/workspaces/:wsId/test/x`, (c) => c.body(null, 204))).toThrow(/serve a piece/);
    // Planning runs none: no trust needed.
    routes.get('planning', `${API_BASE}/workspaces/:wsId/test/x`, (c) => c.body(null, 204));
  });
});

describe('the pre-registered BMad routes (story 10.2)', () => {
  it('pieces and the new-projects default answer 501 without core and never read the body', async () => {
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
    }
    // Filled by story 10.4: served behind the gate, never guarded by a piece.
    // Detection and the offer (story 10.3) are covered by bmad-detection-routes.test.ts.
    expect((await request(server, tab, 'GET', API_ROUTES.newProjectDefaults)).status).toBe(200);
    expect((await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, { bmadPieces: [] })).status).toBe(200);
  });
});
