/**
 * A workspace's BMad pieces over REST (CAP-19, AD-22; story 10.1, the
 * tracer): PATCH settings turns `planning` on and appends one
 * `workspace.settings_changed`, the state survives a server restart, and the
 * test-only probe route, registered only under its test hook, is refused by
 * core's guard with 409 `feature_off` while the piece is off.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, ApiErrorBody, apiPath, FEATURE_OFF_MESSAGE, TEST_ROUTES, WorkspaceResponse, WorkspaceSettingsResponse } from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BMAD_PROBE_ENV } from '../src/test-hooks.js';
import { send, signIn, startTestServer, tempDataDir, type SignedIn, type TestServer } from './helpers.js';

const repos: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function addProject(server: TestServer, tab: SignedIn) {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  repos.push(repo);
  return WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace;
}

const settingsPath = (wsId: string) => apiPath(API_ROUTES.workspaceSettings, { wsId });
const probePath = (wsId: string) => apiPath(TEST_ROUTES.bmadProbe, { wsId });
const settingsOf = async (server: TestServer, tab: SignedIn, wsId: string) =>
  WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', settingsPath(wsId))).json()).settings;

describe('BMad pieces over REST (story 10.1)', () => {
  it('PATCH turns planning on with one settings_changed, refuses a bad piece, and the state survives a restart', async () => {
    const dataDir = tempDataDir();
    const lines: string[] = [];
    const first = await startTestServer({ dataDir, lines, availableBmadPieces: ['planning'] });
    const tab = await signIn(first);
    const workspace = await addProject(first, tab);
    expect(await settingsOf(first, tab, workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });

    const before = first.core.events.lastSeq();
    for (const body of [{ bmadPieces: ['yolo'] }, { bmadPieces: ['planning', 'planning'] }, { bmadPieces: 'planning' }]) {
      const bad = await request(first, tab, 'PATCH', settingsPath(workspace.id), body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(ApiErrorBody.parse(await bad.json()).error.code).toBe('invalid_request');
    }
    expect(first.core.events.lastSeq()).toBe(before);

    const patched = await request(first, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces: ['planning'] });
    expect(patched.status).toBe(200);
    expect(WorkspaceSettingsResponse.parse(await patched.json()).settings).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: ['planning'], bmadScriptsTrusted: false });
    const changed = first.core.events.readAfter(before);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      type: 'workspace.settings_changed',
      workspaceId: workspace.id,
      payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', bmadPieces: ['planning'], previousBmadPieces: [] },
    });
    // No path of the user's is logged.
    expect(lines.join('')).not.toContain(workspace.realPath ?? workspace.path);
    await first.close();

    const second = await startTestServer({ dataDir, availableBmadPieces: ['planning'] });
    const again = await signIn(second);
    expect(await settingsOf(second, again, workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: ['planning'], bmadScriptsTrusted: false });
  });

  it('the probe route answers feature_off while planning is off and succeeds once it is on; it needs a token', async () => {
    vi.stubEnv(BMAD_PROBE_ENV, '1');
    const server = await startTestServer({ availableBmadPieces: ['planning'] });
    const tab = await signIn(server);
    const workspace = await addProject(server, tab);

    const off = await request(server, tab, 'GET', probePath(workspace.id));
    expect(off.status).toBe(409);
    const refused = ApiErrorBody.parse(await off.json()).error;
    expect(refused.code).toBe('feature_off');
    expect(refused.message).toBe(FEATURE_OFF_MESSAGE);

    expect((await request(server, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces: ['planning'] })).status).toBe(200);
    const on = await request(server, tab, 'GET', probePath(workspace.id));
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ piece: 'planning' });

    expect((await request(server, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces: [] })).status).toBe(200);
    expect((await request(server, tab, 'GET', probePath(workspace.id))).status).toBe(409);

    expect((await request(server, tab, 'GET', probePath('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3'))).status).toBe(404);
    expect((await send(server, probePath(workspace.id))).status).toBe(401);
  });

  it('without its test hook the probe route is not registered', async () => {
    const server = await startTestServer({ availableBmadPieces: ['planning'] });
    const tab = await signIn(server);
    const workspace = await addProject(server, tab);
    expect((await request(server, tab, 'PATCH', settingsPath(workspace.id), { bmadPieces: ['planning'] })).status).toBe(200);
    const missing = await request(server, tab, 'GET', probePath(workspace.id));
    expect(missing.status).toBe(404);
    expect(ApiErrorBody.parse(await missing.json()).error.code).toBe('not_found');
  });
});
