/**
 * Default permission mode end to end: a real server, the real
 * `acp-claude-code` adapter and the fake ACP agent. A project's default
 * decides the mode a new chat's agent runs in before its first prompt; Skip
 * all as a default (a project's or the app-wide one) is refused straight from
 * the API without Developer mode or the confirmation, writing nothing; and
 * turning Developer mode off sets both back to Ask.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  NewProjectDefaultsResponse,
  SessionResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type SessionId,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

const repos: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function start() {
  const server = await startTestServer({ claudeAdapterPath: FAKE_AGENT, dataDir: tempDataDir() });
  servers.push(server);
  return { server, tab: await signIn(server) };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function addProject(server: TestServer, tab: SignedIn): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-repo-'));
  repos.push(repo);
  return WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
}

const settingsPath = (wsId: string) => apiPath(API_ROUTES.workspaceSettings, { wsId });
const patchSettings = (server: TestServer, tab: SignedIn, wsId: string, body: unknown) => request(server, tab, 'PATCH', settingsPath(wsId), body);
const settingsOf = async (server: TestServer, tab: SignedIn, wsId: string) => WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', settingsPath(wsId))).json()).settings;
const setDeveloperMode = (server: TestServer, tab: SignedIn, developerMode: boolean) => request(server, tab, 'PUT', API_ROUTES.developerMode, { developerMode });
const refusalOf = async (response: Response) => ({ status: response.status, code: ApiErrorBody.parse(await response.json()).error.code });

async function newChat(server: TestServer, tab: SignedIn, wsId: string) {
  const { session } = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), {})).json());
  return session;
}

/** Sends `text` and returns the agent's reply. */
async function say(server: TestServer, tab: SignedIn, wsId: string, sesId: SessionId, text: string): Promise<string> {
  const replies = () =>
    server.core.events.readAfter(0).flatMap((e) => (e.streamId === sesId && e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));
  const before = replies().length;
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text })).status).toBe(202);
  await waitFor(() => server.core.entities.getSession(sesId)!.state === 'idle' && replies().length > before, `the reply to ${text}`, 15_000);
  return replies().at(-1)!;
}

describe("a new chat's agent runs in its project's default", () => {
  it('starts the agent in Auto before its first prompt', async () => {
    const { server, tab } = await start();
    const wsId = await addProject(server, tab);
    expect((await patchSettings(server, tab, wsId, { defaultPermissionMode: 'auto' })).status).toBe(200);
    expect((await settingsOf(server, tab, wsId)).defaultPermissionMode).toBe('auto');
    const session = await newChat(server, tab, wsId);
    expect(session.permissionMode).toBe('auto');
    expect(await say(server, tab, wsId, session.id, 'mode')).toBe('mode=auto');
  });

  it('starts the agent skipping checks only from a confirmed Skip all default with Developer mode on', async () => {
    const { server, tab } = await start();
    const wsId = await addProject(server, tab);
    expect((await setDeveloperMode(server, tab, true)).status).toBe(200);
    expect((await patchSettings(server, tab, wsId, { defaultPermissionMode: 'skip_all', confirm: true })).status).toBe(200);
    const session = await newChat(server, tab, wsId);
    expect(session.permissionMode).toBe('skip_all');
    expect(await say(server, tab, wsId, session.id, 'mode')).toBe('mode=bypassPermissions');
  });
});

describe('Skip all as a default is enforced by the server', () => {
  it("refuses a project's Skip all without Developer mode or the confirmation, recording nothing", async () => {
    const { server, tab } = await start();
    const wsId = await addProject(server, tab);
    const before = server.core.events.readAfter(0).length;
    expect(await refusalOf(await patchSettings(server, tab, wsId, { defaultPermissionMode: 'skip_all', confirm: true }))).toEqual({ status: 403, code: 'developer_mode_required' });
    expect(server.core.events.readAfter(0)).toHaveLength(before);
    await setDeveloperMode(server, tab, true);
    const on = server.core.events.readAfter(0).length;
    expect(await refusalOf(await patchSettings(server, tab, wsId, { defaultPermissionMode: 'skip_all' }))).toEqual({ status: 400, code: 'confirmation_required' });
    expect(server.core.events.readAfter(0)).toHaveLength(on);
    expect((await settingsOf(server, tab, wsId)).defaultPermissionMode ?? 'ask').toBe('ask');
  });

  it('refuses the app-wide Skip all the same way', async () => {
    const { server, tab } = await start();
    const patch = (body: unknown) => request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, body);
    expect(await refusalOf(await patch({ defaultPermissionMode: 'skip_all', confirm: true }))).toEqual({ status: 403, code: 'developer_mode_required' });
    await setDeveloperMode(server, tab, true);
    expect(await refusalOf(await patch({ defaultPermissionMode: 'skip_all' }))).toEqual({ status: 400, code: 'confirmation_required' });
    const saved = NewProjectDefaultsResponse.parse(await (await patch({ defaultPermissionMode: 'skip_all', confirm: true })).json());
    expect(saved.defaults.defaultPermissionMode).toBe('skip_all');
  });

  it('turning Developer mode off sets project and app-wide Skip all defaults back to Ask, with a notice', async () => {
    const { server, tab } = await start();
    const wsId = await addProject(server, tab);
    await setDeveloperMode(server, tab, true);
    await patchSettings(server, tab, wsId, { defaultPermissionMode: 'skip_all', confirm: true });
    await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, { defaultPermissionMode: 'skip_all', confirm: true });
    const chat = await newChat(server, tab, wsId);
    expect(chat.permissionMode).toBe('skip_all');

    expect((await setDeveloperMode(server, tab, false)).status).toBe(200);
    expect(await settingsOf(server, tab, wsId)).toMatchObject({ defaultPermissionMode: 'ask', defaultPermissionModeNotice: 'developer_mode_off' });
    expect(server.core.entities.getSession(chat.id)?.permissionMode).toBe('ask');
    expect((await newChat(server, tab, wsId)).permissionMode).toBe('ask');
    // Still Ask when Developer mode comes back: nothing turns Skip all on again by itself.
    await setDeveloperMode(server, tab, true);
    const defaults = NewProjectDefaultsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.newProjectDefaults)).json()).defaults;
    expect(defaults.defaultPermissionMode).toBe('ask');
    expect((await newChat(server, tab, wsId)).permissionMode).toBe('ask');
  });
});
