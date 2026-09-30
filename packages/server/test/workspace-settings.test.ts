/**
 * The workspace settings routes (story 2.8): a real server, the real
 * `acp-claude-code` adapter and the fake ACP agent. GET and PATCH read and
 * set the caution level behind the gate (AD-15); a change appends
 * `workspace.settings_changed`; and a lower level lets a read inside the
 * project run without a card while a command still waits.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  SessionResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type CoreEvent,
  type SessionId,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { send, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

const repos: string[] = [];
const servers: TestServer[] = [];
// Servers first (closing one stops its agents), then the repo folders (Windows).
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function startChatServer(lines?: string[]) {
  const server = await startTestServer({ claudeAdapterPath: FAKE_AGENT, ...(lines === undefined ? {} : { lines }) });
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

async function openChat(server: TestServer, tab: SignedIn) {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  repos.push(repo);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'a');
  const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json());
  const { session } = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
  return { workspace, session };
}

const sessionEvents = (server: TestServer, sessionId: SessionId): CoreEvent[] => server.core.events.readAfter(0).filter((e) => e.streamId === sessionId);
const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;
const replies = (server: TestServer, sessionId: SessionId) =>
  sessionEvents(server, sessionId).flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));
const requestedCount = (server: TestServer, sessionId: SessionId) => sessionEvents(server, sessionId).filter((e) => e.type === 'permission.requested').length;

const settingsPath = (wsId: string) => apiPath(API_ROUTES.workspaceSettings, { wsId });

describe('workspace settings routes', () => {
  it('GET is the default level; PATCH validates, saves, and appends settings_changed only on a change', async () => {
    const lines: string[] = [];
    const { server, tab } = await startChatServer(lines);
    const { workspace } = await openChat(server, tab);

    const got = await request(server, tab, 'GET', settingsPath(workspace.id));
    expect(got.status).toBe(200);
    expect(WorkspaceSettingsResponse.parse(await got.json())).toEqual({ settings: { cautionLevel: 'ask_every_time' } });

    const before = server.core.events.lastSeq();
    for (const body of [{ cautionLevel: 'yolo' }, {}, { cautionLevel: 1 }]) {
      const bad = await request(server, tab, 'PATCH', settingsPath(workspace.id), body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(ApiErrorBody.parse(await bad.json()).error.code).toBe('invalid_request');
    }
    const junk = await send(server, settingsPath(workspace.id), { method: 'PATCH', headers: { ...tab.headers, 'content-type': 'application/json' }, body: '{nope' });
    expect(junk.status).toBe(400);
    expect(server.core.events.lastSeq()).toBe(before);

    const patched = await request(server, tab, 'PATCH', settingsPath(workspace.id), { cautionLevel: 'ask_for_commands' });
    expect(patched.status).toBe(200);
    expect(WorkspaceSettingsResponse.parse(await patched.json()).settings.cautionLevel).toBe('ask_for_commands');
    const changed = server.core.events.readAfter(before).filter((e) => e.type === 'workspace.settings_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ workspaceId: workspace.id, payload: { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' } });

    const again = server.core.events.lastSeq();
    expect((await request(server, tab, 'PATCH', settingsPath(workspace.id), { cautionLevel: 'ask_for_commands' })).status).toBe(200);
    expect(server.core.events.lastSeq()).toBe(again);
    expect(WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', settingsPath(workspace.id))).json()).settings.cautionLevel).toBe('ask_for_commands');
    // No path of the user's is logged.
    expect(lines.join('')).not.toContain(workspace.realPath ?? workspace.path);
  });

  it('an unknown or malformed workspace is 404; no token is 401; a PATCH from a foreign Origin is 403', async () => {
    const { server, tab } = await startChatServer();
    const { workspace } = await openChat(server, tab);
    const unknown = settingsPath('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3');
    expect((await request(server, tab, 'GET', unknown)).status).toBe(404);
    expect((await request(server, tab, 'PATCH', unknown, { cautionLevel: 'ask_risky_only' })).status).toBe(404);
    expect((await request(server, tab, 'GET', settingsPath('not-an-id'))).status).toBe(404);

    expect((await send(server, settingsPath(workspace.id), { method: 'GET', headers: { origin: server.url } })).status).toBe(401);
    const foreign = await send(server, settingsPath(workspace.id), {
      method: 'PATCH',
      headers: { ...tab.headers, origin: 'http://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ cautionLevel: 'ask_risky_only' }),
    });
    expect(foreign.status).toBe(403);
    expect(server.core.permissions.getSettings(workspace.id).cautionLevel).toBe('ask_every_time');
  });

  it('a read inside the project asks at the default, runs without a card at Ask for commands, and a command still waits', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    const wsId = workspace.id;
    const message = (text: string) => request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text });
    const waitForCard = async (count: number) =>
      waitFor(() => stateOf(server, session.id) === 'waiting' && requestedCount(server, session.id) === count, 'the card', 15_000);
    const idle = () => waitFor(() => stateOf(server, session.id) === 'idle', 'idle', 15_000);

    expect((await message('permission-kind read src/a.ts')).status).toBe(202);
    await waitForCard(1);
    const first = sessionEvents(server, session.id).find((e) => e.type === 'permission.requested');
    expect(first?.type === 'permission.requested' && first.payload.cautionLevel).toBe('ask_every_time');
    // Lowering the level while the card is shown changes nothing about it.
    expect((await request(server, tab, 'PATCH', settingsPath(wsId), { cautionLevel: 'ask_for_commands' })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stateOf(server, session.id)).toBe('waiting');
    expect(sessionEvents(server, session.id).some((e) => e.type === 'permission.resolved')).toBe(false);
    const requestId = first?.type === 'permission.requested' ? first.payload.requestId : '';
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId, sesId: session.id, requestId }), { decision: 'deny' })).status).toBe(204);
    await idle();

    expect((await message('permission-kind read src/a.ts')).status).toBe(202);
    await waitFor(() => replies(server, session.id).length === 2, 'the reply', 15_000);
    await idle();
    expect(replies(server, session.id).at(-1)).toBe('Did read src/a.ts.');
    expect(sessionEvents(server, session.id).filter((e) => e.type === 'permission.resolved').at(-1)?.payload).toMatchObject({ decision: 'allow_once', by: 'caution' });

    // Outside the project, and a command, still ask.
    expect((await message('permission-kind read ../outside.txt')).status).toBe(202);
    await waitForCard(3);
    const outside = sessionEvents(server, session.id).filter((e) => e.type === 'permission.requested').at(-1);
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId, sesId: session.id, requestId: outside?.type === 'permission.requested' ? outside.payload.requestId : '' }), { decision: 'deny' })).status).toBe(204);
    await idle();
    expect((await message('permission npm test')).status).toBe(202);
    await waitForCard(4);
  });

  it('a search pattern that reaches outside the project asks at Ask for commands; one inside runs (review F2)', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    const wsId = workspace.id;
    expect((await request(server, tab, 'PATCH', settingsPath(wsId), { cautionLevel: 'ask_for_commands' })).status).toBe(200);
    const message = (text: string) => request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text });
    const idle = () => waitFor(() => stateOf(server, session.id) === 'idle', 'idle', 15_000);

    expect((await message('permission-kind search-pattern src/**/*.ts')).status).toBe(202);
    await waitFor(() => replies(server, session.id).length === 1, 'the reply', 15_000);
    await idle();
    expect(replies(server, session.id)[0]).toBe('Did search src/**/*.ts.');

    let cards = 0;
    for (const pattern of ['/Users/x/.ssh/*', '~/x/*', '../../x/*']) {
      expect((await message(`permission-kind search-pattern ${pattern}`)).status, pattern).toBe(202);
      cards += 1;
      await waitFor(() => stateOf(server, session.id) === 'waiting' && requestedCount(server, session.id) === cards + 1, `the card for ${pattern}`, 15_000);
      const card = sessionEvents(server, session.id).filter((e) => e.type === 'permission.requested').at(-1);
      const requestId = card?.type === 'permission.requested' ? card.payload.requestId : '';
      expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId, sesId: session.id, requestId }), { decision: 'deny' })).status).toBe(204);
      await idle();
    }
  });
});
