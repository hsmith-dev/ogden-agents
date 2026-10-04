/**
 * Permission modes end to end: a real server, the real `acp-claude-code`
 * adapter and the fake ACP agent (its switches set by wrapper fixtures, as
 * the server passes agents an allowlisted environment). The server enforces
 * every rule straight from the API, not only in the UI: Skip all needs
 * Developer mode and the confirmation, a mode the agent doesn't offer is
 * refused, and each refusal records no event.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  DeveloperModeResponse,
  SessionResponse,
  WorkspaceResponse,
  type CoreEvent,
  type PermissionRequestedEvent,
  type SessionId,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures');
const FAKE_AGENT = join(FIXTURES, 'fake-acp-agent.mjs');

const repos: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function startChatServer(agent = FAKE_AGENT, dataDir = tempDataDir()) {
  const server = await startTestServer({ claudeAdapterPath: agent, dataDir });
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

async function openChat(server: TestServer, tab: SignedIn, wsId?: string) {
  let workspaceId = wsId;
  if (workspaceId === undefined) {
    const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-repo-'));
    repos.push(repo);
    workspaceId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  }
  const { session } = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: workspaceId }), {})).json());
  return { wsId: workspaceId, sesId: session.id };
}

const streamOf = (server: TestServer, sessionId: SessionId): CoreEvent[] => server.core.events.readAfter(0).filter((e) => e.streamId === sessionId);
const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;
const replies = (server: TestServer, sessionId: SessionId) =>
  streamOf(server, sessionId).flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));
const modeChanges = (server: TestServer, sessionId: SessionId) =>
  streamOf(server, sessionId).flatMap((e) => (e.type === 'session.permission_mode_changed' ? [[e.payload.previous, e.payload.mode, e.payload.cause]] : []));

/** Sends `text` and waits for the reply (the session idle with one more agent message). */
async function say(server: TestServer, tab: SignedIn, ids: { wsId: string; sesId: SessionId }, text: string): Promise<string> {
  const before = replies(server, ids.sesId).length;
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, ids), { text })).status).toBe(202);
  await waitFor(() => stateOf(server, ids.sesId) === 'idle' && replies(server, ids.sesId).length > before, `the reply to ${text}`, 15_000);
  return replies(server, ids.sesId).at(-1)!;
}

const setMode = (server: TestServer, tab: SignedIn, ids: { wsId: string; sesId: string }, body: unknown) => request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), body);
const setDeveloperMode = (server: TestServer, tab: SignedIn, developerMode: boolean) => request(server, tab, 'PUT', API_ROUTES.developerMode, { developerMode });

const refusalOf = async (response: Response) => ({ status: response.status, code: ApiErrorBody.parse(await response.json()).error.code });

describe('a chat starts in Ask (criterion 1)', () => {
  it('an agent whose own settings start it skipping permissions is told Ask before the first prompt', async () => {
    const { server, tab } = await startChatServer(join(FIXTURES, 'fake-acp-agent-start-bypass.mjs'));
    const ids = await openChat(server, tab);
    const read = SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, ids))).json());
    expect(read.session.permissionMode).toBe('ask');
    expect(read.permissionModes).toEqual([
      { mode: 'ask', available: true },
      { mode: 'auto', available: true },
      { mode: 'skip_all', available: true },
    ]);
    expect(await say(server, tab, ids, 'mode')).toBe('mode=default');
    // And a command it asks about shows a card, as before.
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, ids), { text: 'permission npm test' })).status).toBe(202);
    await waitFor(() => stateOf(server, ids.sesId) === 'waiting', 'the card', 15_000);
  }, 30_000);

  it('a restart sets a chat in Auto back to Ask (cause restart), and its reopened agent runs in Ask', async () => {
    const dataDir = tempDataDir();
    const first = await startChatServer(FAKE_AGENT, dataDir);
    const ids = await openChat(first.server, first.tab);
    expect((await setMode(first.server, first.tab, ids, { mode: 'auto' })).status).toBe(200);
    expect(await say(first.server, first.tab, ids, 'mode')).toBe('mode=auto');
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);

    const { server, tab } = await startChatServer(FAKE_AGENT, dataDir);
    expect(server.core.entities.getSession(ids.sesId)!.permissionMode).toBe('ask');
    expect(modeChanges(server, ids.sesId)).toEqual([
      ['ask', 'auto', 'user'],
      ['auto', 'ask', 'restart'],
    ]);
    expect(await say(server, tab, ids, 'mode')).toBe('mode=default');
  }, 45_000);
});

describe('Auto (criteria 2, 3, 10)', () => {
  it('PUT Auto: one event (cause user), the live agent in auto, the mode survives a reload; the same mode again appends nothing', async () => {
    const { server, tab } = await startChatServer();
    const ids = await openChat(server, tab);
    await say(server, tab, ids, 'hello');
    const response = await setMode(server, tab, ids, { mode: 'auto' });
    expect(response.status).toBe(200);
    expect(SessionResponse.parse(await response.json()).session.permissionMode).toBe('auto');
    expect(modeChanges(server, ids.sesId)).toEqual([['ask', 'auto', 'user']]);
    expect(await say(server, tab, ids, 'mode')).toBe('mode=auto');
    expect((await setMode(server, tab, ids, { mode: 'auto' })).status).toBe(200);
    expect(modeChanges(server, ids.sesId)).toHaveLength(1);
    const reread = SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, ids))).json());
    expect(reread.session.permissionMode).toBe('auto');
  }, 30_000);

  it('an agent whose model lacks Auto falls back to accepting edits: the chat moves to Ask (cause agent) and the agent is told Ask', async () => {
    const { server, tab } = await startChatServer(join(FIXTURES, 'fake-acp-agent-auto-fallback.mjs'));
    const ids = await openChat(server, tab);
    await say(server, tab, ids, 'hello');
    expect((await setMode(server, tab, ids, { mode: 'auto' })).status).toBe(200);
    // Its agent restarts with the protected paths guarded, and falls back as it takes Auto.
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, ids), { text: 'hello again' })).status).toBe(202);
    await waitFor(() => modeChanges(server, ids.sesId).length === 2, 'the fallback', 10_000);
    await waitFor(() => stateOf(server, ids.sesId) === 'idle', 'idle', 15_000);
    expect(modeChanges(server, ids.sesId)).toEqual([
      ['ask', 'auto', 'user'],
      ['auto', 'ask', 'agent'],
    ]);
    const fallback = streamOf(server, ids.sesId).findLast((e) => e.type === 'session.permission_mode_changed');
    expect(fallback).toMatchObject({ payload: { reason: 'Claude Code switched itself to Accept edits, so this chat is back in Ask.' } });
    await waitFor(async () => (await say(server, tab, ids, 'mode')) === 'mode=default', 'the agent in Ask', 15_000);
  }, 30_000);
});

describe('Auto keeps protected files guarded (user decision 2026-10-02)', () => {
  it("an Auto chat's edit of a protected file still shows a card; another edit runs without one; Ask is unchanged", async () => {
    const { server, tab } = await startChatServer();
    const ids = await openChat(server, tab);
    // In Ask, every edit asks (as before).
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, ids), { text: 'permission-edit src/a.ts' })).status).toBe(202);
    await waitFor(() => stateOf(server, ids.sesId) === 'waiting', 'the Ask card', 15_000);
    const askCard = streamOf(server, ids.sesId).findLast((e): e is PermissionRequestedEvent => e.type === 'permission.requested')!;
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { ...ids, requestId: askCard.payload.requestId }), { decision: 'allow_once' })).status).toBe(204);
    await waitFor(() => stateOf(server, ids.sesId) === 'idle', 'idle', 15_000);

    expect((await setMode(server, tab, ids, { mode: 'auto' })).status).toBe(200);
    expect(await say(server, tab, ids, 'guards')).toContain('Edit(**/.claude/**)');
    expect(await say(server, tab, ids, 'permission-edit src/a.ts')).toBe('Edited src/a.ts.');
    const cards = () => streamOf(server, ids.sesId).filter((e) => e.type === 'permission.requested').length;
    expect(cards()).toBe(1);
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, ids), { text: 'permission-edit .claude/settings.json' })).status).toBe(202);
    await waitFor(() => stateOf(server, ids.sesId) === 'waiting', 'the protected-path card', 15_000);
    const card = streamOf(server, ids.sesId).findLast((e): e is PermissionRequestedEvent => e.type === 'permission.requested')!;
    expect(card.payload).toMatchObject({ permissionMode: 'auto', toolCall: { protectedPath: true } });
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { ...ids, requestId: card.payload.requestId }), { decision: 'deny' })).status).toBe(204);
    await waitFor(() => stateOf(server, ids.sesId) === 'idle', 'idle', 15_000);
  }, 45_000);

  it('a Skip-all chat starts with no ask rules, and Auto to Skip all restarts it without them', async () => {
    const { server, tab } = await startChatServer();
    const ids = await openChat(server, tab);
    expect((await setDeveloperMode(server, tab, true)).status).toBe(200);
    expect((await setMode(server, tab, ids, { mode: 'auto' })).status).toBe(200);
    expect(await say(server, tab, ids, 'guards')).toContain('Edit(**/.git/**)');
    expect((await setMode(server, tab, ids, { mode: 'skip_all', confirm: true })).status).toBe(200);
    expect(await say(server, tab, ids, 'guards')).toBe('ask=[]');
    expect(await say(server, tab, ids, 'mode')).toBe('mode=bypassPermissions');
  }, 45_000);
});

describe('a mode the agent cannot offer (criterion 4)', () => {
  it('a session that lists neither Auto nor Skip all: unavailable with a reason, and refused 409 with no event', async () => {
    const { server, tab } = await startChatServer(join(FIXTURES, 'fake-acp-agent-no-modes.mjs'));
    const ids = await openChat(server, tab);
    await say(server, tab, ids, 'hello');
    const read = SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, ids))).json());
    expect(read.permissionModes).toEqual([
      { mode: 'ask', available: true },
      { mode: 'auto', available: false, reason: "This chat's Claude Code session doesn't offer Auto on this computer." },
      { mode: 'skip_all', available: false, reason: "This chat's Claude Code session doesn't offer Skip all on this computer." },
    ]);
    expect(await refusalOf(await setMode(server, tab, ids, { mode: 'auto' }))).toEqual({ status: 409, code: 'mode_unavailable' });
    expect((await setDeveloperMode(server, tab, true)).status).toBe(200);
    expect(await refusalOf(await setMode(server, tab, ids, { mode: 'skip_all', confirm: true }))).toEqual({ status: 409, code: 'mode_unavailable' });
    expect(modeChanges(server, ids.sesId)).toEqual([]);
    expect(await refusalOf(await setMode(server, tab, ids, { mode: 'everything' }))).toEqual({ status: 400, code: 'invalid_request' });
  }, 30_000);
});

describe('Skip all, enforced by the server (criteria 5 and 7)', () => {
  it('refused straight from the API without Developer mode (403) or without the confirmation (400), recording nothing; set with both', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ claudeAdapterPath: FAKE_AGENT, lines });
    servers.push(server);
    const tab = await signIn(server);
    const ids = await openChat(server, tab);
    await say(server, tab, ids, 'hello');
    expect(await refusalOf(await setMode(server, tab, ids, { mode: 'skip_all', confirm: true }))).toEqual({ status: 403, code: 'developer_mode_required' });
    // Never set on this install yet (a browser may carry its old "on" over once).
    expect(DeveloperModeResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.developerMode)).json())).toEqual({ developerMode: false, everSet: false });
    expect((await setDeveloperMode(server, tab, true)).status).toBe(200);
    expect(DeveloperModeResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.developerMode)).json())).toEqual({ developerMode: true, everSet: true });
    expect(await refusalOf(await setMode(server, tab, ids, { mode: 'skip_all' }))).toEqual({ status: 400, code: 'confirmation_required' });
    expect(await refusalOf(await setMode(server, tab, ids, { mode: 'skip_all', confirm: false }))).toEqual({ status: 400, code: 'confirmation_required' });
    expect(modeChanges(server, ids.sesId)).toEqual([]);
    expect(await say(server, tab, ids, 'mode')).toBe('mode=default');

    expect((await setMode(server, tab, ids, { mode: 'skip_all', confirm: true })).status).toBe(200);
    expect(modeChanges(server, ids.sesId)).toEqual([['ask', 'skip_all', 'user']]);
    // Claude Code skips its checks: the command runs with no card.
    expect(await say(server, tab, ids, 'permission npm test')).toBe('Ran npm test.');
    // One of its own safety checks still asks: a card with no Always allow, which the server refuses.
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, ids), { text: 'permission-safety rm -rf .git' })).status).toBe(202);
    await waitFor(() => stateOf(server, ids.sesId) === 'waiting', 'the card', 15_000);
    const card = streamOf(server, ids.sesId).findLast((e): e is PermissionRequestedEvent => e.type === 'permission.requested')!;
    expect(card.payload).toMatchObject({ permissionMode: 'skip_all', alwaysAllowScope: null });
    const decide = (decision: string) => request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { ...ids, requestId: card.payload.requestId }), { decision });
    expect(await refusalOf(await decide('allow_always'))).toEqual({ status: 400, code: 'invalid_request' });
    expect((await decide('deny')).status).toBe(204);
    await waitFor(() => stateOf(server, ids.sesId) === 'idle', 'idle', 15_000);
    expect(server.core.permissions.listRules(ids.wsId as never)).toEqual([]);
    // The log names the mode and codes, never more.
    expect(lines.some((line) => line.includes('chat permission mode refused') && line.includes('developer_mode_required'))).toBe(true);
  }, 45_000);
});

describe('turning Developer mode off (criterion 8)', () => {
  it('drops every Skip-all chat to Ask in one go, tells their agents, and every tab hears it as events', async () => {
    const { server, tab } = await startChatServer();
    const one = await openChat(server, tab);
    const two = await openChat(server, tab, one.wsId);
    const other = await openChat(server, tab);
    expect((await setDeveloperMode(server, tab, true)).status).toBe(200);
    for (const ids of [one, two]) {
      await say(server, tab, ids, 'hello');
      expect((await setMode(server, tab, ids, { mode: 'skip_all', confirm: true })).status).toBe(200);
    }
    await say(server, tab, other, 'hello');
    const before = server.core.events.lastSeq();

    const off = await setDeveloperMode(server, tab, false);
    expect(DeveloperModeResponse.parse(await off.json())).toEqual({ developerMode: false, everSet: true });
    // Once set, it stays set: an old browser never carries its "on" over this choice.
    expect(DeveloperModeResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.developerMode)).json())).toEqual({ developerMode: false, everSet: true });
    const appended = server.core.events.readAfter(before).filter((e) => e.type === 'settings.developer_mode_changed' || e.type === 'session.permission_mode_changed');
    expect(appended.map((e) => [e.type, e.streamId])).toEqual([
      ['settings.developer_mode_changed', 'settings'],
      ['session.permission_mode_changed', one.sesId],
      ['session.permission_mode_changed', two.sesId],
    ]);
    for (const ids of [one, two]) {
      expect(modeChanges(server, ids.sesId).at(-1)).toEqual(['skip_all', 'ask', 'developer_mode_off']);
      expect(await say(server, tab, ids, 'mode')).toBe('mode=default');
    }
    expect(modeChanges(server, other.sesId)).toEqual([]);
    // Off again changes nothing.
    expect((await setDeveloperMode(server, tab, false)).status).toBe(200);
    expect(server.core.events.readAfter(before).filter((e) => e.type === 'settings.developer_mode_changed')).toHaveLength(1);
  }, 45_000);
});
