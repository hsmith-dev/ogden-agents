/**
 * The permission routes end to end (story 2.6): a real server, the real
 * `acp-claude-code` adapter and the fake ACP agent. Nothing runs until the
 * user answers the card; Allow once, Deny and Always allow reach the agent
 * as "once" or "deny"; a stored rule answers the next request in scope; a
 * stale answer is 409; and every route is behind the gate (AD-15).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  PermissionRulesResponse,
  SessionResponse,
  WorkspaceResponse,
  type CoreEvent,
  type PermissionRequestedEvent,
  type SessionId,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

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
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-repo-'));
  repos.push(repo);
  const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json());
  const { session } = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
  return { workspace, session };
}

const sessionEvents = (server: TestServer, sessionId: SessionId): CoreEvent[] => server.core.events.readAfter(0).filter((e) => e.streamId === sessionId);
const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;
const replies = (server: TestServer, sessionId: SessionId) =>
  sessionEvents(server, sessionId).flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));

/** Sends `text` and waits for the card: the session `waiting` with a new `permission.requested`. */
async function ask(server: TestServer, tab: SignedIn, wsId: string, sesId: SessionId, text: string): Promise<PermissionRequestedEvent> {
  const before = sessionEvents(server, sesId).filter((e) => e.type === 'permission.requested').length;
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text })).status).toBe(202);
  await waitFor(() => stateOf(server, sesId) === 'waiting' && sessionEvents(server, sesId).filter((e) => e.type === 'permission.requested').length > before, 'the card', 15_000);
  return sessionEvents(server, sesId).filter((e): e is PermissionRequestedEvent => e.type === 'permission.requested').at(-1)!;
}

const decide = (server: TestServer, tab: SignedIn, wsId: string, sesId: string, requestId: string, body: unknown) =>
  request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId, sesId, requestId }), body);

const idle = (server: TestServer, sesId: SessionId) => waitFor(() => stateOf(server, sesId) === 'idle', 'idle', 15_000);

describe('permission cards through the fake ACP agent', () => {
  it('holds the command until Allow once, then it runs; a second answer is 409', async () => {
    const lines: string[] = [];
    const { server, tab } = await startChatServer(lines);
    const { workspace, session } = await openChat(server, tab);
    const requested = await ask(server, tab, workspace.id, session.id, 'permission');
    expect(requested.payload.toolCall).toMatchObject({ kind: 'execute', command: 'npm test' });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(stateOf(server, session.id)).toBe('waiting');
    expect(replies(server, session.id)).toEqual([]);

    const allowed = await decide(server, tab, workspace.id, session.id, requested.payload.requestId, { decision: 'allow_once' });
    expect(allowed.status).toBe(204);
    await idle(server, session.id);
    expect(replies(server, session.id)).toEqual(['Ran npm test.']);
    const states = sessionEvents(server, session.id).flatMap((e) => (e.type === 'session.state_changed' ? [e.payload.state] : []));
    expect(states).toEqual(['working', 'waiting', 'working', 'idle']);

    const again = await decide(server, tab, workspace.id, session.id, requested.payload.requestId, { decision: 'allow_once' });
    expect(again.status).toBe(409);
    expect(ApiErrorBody.parse(await again.json()).error.code).toBe('permission_not_pending');
    // The command is the user's project detail: the log names the decision, not the command.
    expect(lines.join('')).not.toContain('npm test');
  });

  it('Deny records its reason and the agent reports Denied; a too-long reason or a bad body is 400', async () => {
    const lines: string[] = [];
    const { server, tab } = await startChatServer(lines);
    const { workspace, session } = await openChat(server, tab);
    const { payload } = await ask(server, tab, workspace.id, session.id, 'permission');

    const long = await decide(server, tab, workspace.id, session.id, payload.requestId, { decision: 'deny', reason: 'x'.repeat(2001) });
    expect(long.status).toBe(400);
    expect(ApiErrorBody.parse(await long.json()).error.code).toBe('invalid_request');
    expect((await decide(server, tab, workspace.id, session.id, payload.requestId, { decision: 'maybe' })).status).toBe(400);
    expect(stateOf(server, session.id)).toBe('waiting');

    const reason = 'Run the unit tests only, secret-reason-words';
    expect((await decide(server, tab, workspace.id, session.id, payload.requestId, { decision: 'deny', reason })).status).toBe(204);
    await idle(server, session.id);
    expect(replies(server, session.id)).toEqual(['Denied npm test.']);
    const resolved = sessionEvents(server, session.id).find((e) => e.type === 'permission.resolved');
    expect(resolved?.payload).toMatchObject({ decision: 'deny', by: 'user', reason });
    expect(lines.join('')).not.toContain('secret-reason-words');
  });

  it('Always allow stores a rule; the same prefix then runs without a card until the rule is undone', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    const rulesPath = apiPath(API_ROUTES.permissionRules, { wsId: workspace.id });
    const first = await ask(server, tab, workspace.id, session.id, 'permission npm install stripe');
    expect(first.payload.alwaysAllowScope).toEqual({ kind: 'command_prefix', value: 'npm install', label: 'npm install' });
    expect((await decide(server, tab, workspace.id, session.id, first.payload.requestId, { decision: 'allow_always' })).status).toBe(204);
    await idle(server, session.id);

    const { rules } = PermissionRulesResponse.parse(await (await request(server, tab, 'GET', rulesPath)).json());
    expect(rules.map((rule) => rule.scope.value)).toEqual(['npm install']);

    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: session.id }), { text: 'permission npm install lodash' })).status).toBe(202);
    await waitFor(() => replies(server, session.id).length === 2, 'the second reply', 15_000);
    await idle(server, session.id);
    expect(replies(server, session.id)).toEqual(['Ran npm install stripe.', 'Ran npm install lodash.']);
    expect(sessionEvents(server, session.id).flatMap((e) => (e.type === 'session.state_changed' ? [e.payload.state] : []))).toEqual([
      'working',
      'waiting',
      'working',
      'idle',
      'working',
      'idle',
    ]);
    expect(sessionEvents(server, session.id).filter((e) => e.type === 'permission.resolved').at(-1)?.payload).toMatchObject({ by: 'rule', ruleId: rules[0]!.id });

    // A compound command is never covered by a rule.
    const compound = await ask(server, tab, workspace.id, session.id, 'permission npm install x && rm -rf build');
    expect((await decide(server, tab, workspace.id, session.id, compound.payload.requestId, { decision: 'deny' })).status).toBe(204);
    await idle(server, session.id);

    const rulePath = apiPath(API_ROUTES.permissionRule, { wsId: workspace.id, ruleId: rules[0]!.id });
    expect((await request(server, tab, 'DELETE', rulePath)).status).toBe(204);
    expect((await request(server, tab, 'DELETE', rulePath)).status).toBe(404);
    expect(PermissionRulesResponse.parse(await (await request(server, tab, 'GET', rulesPath)).json()).rules).toEqual([]);
    const after = await ask(server, tab, workspace.id, session.id, 'permission npm install lodash');
    expect((await decide(server, tab, workspace.id, session.id, after.payload.requestId, { decision: 'deny' })).status).toBe(204);
    await idle(server, session.id);
  });

  it('answers 409 for another session or workspace or an unknown request, and 404 for an unknown workspace or rule', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    const other = await openChat(server, tab);
    const { payload } = await ask(server, tab, workspace.id, session.id, 'permission');

    expect((await decide(server, tab, other.workspace.id, session.id, payload.requestId, { decision: 'allow_once' })).status).toBe(409);
    expect((await decide(server, tab, workspace.id, other.session.id, payload.requestId, { decision: 'allow_once' })).status).toBe(409);
    expect((await decide(server, tab, workspace.id, session.id, 'x'.repeat(200), { decision: 'allow_once' })).status).toBe(409);
    expect(stateOf(server, session.id)).toBe('waiting');

    const unknownWs = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
    expect((await request(server, tab, 'GET', apiPath(API_ROUTES.permissionRules, { wsId: unknownWs }))).status).toBe(404);
    expect((await request(server, tab, 'GET', apiPath(API_ROUTES.permissionRules, { wsId: 'nope' }))).status).toBe(404);
    expect((await request(server, tab, 'DELETE', apiPath(API_ROUTES.permissionRule, { wsId: workspace.id, ruleId: 'rule_01J9Z3K4M5N6P7Q8R9S0T1V2W3' }))).status).toBe(404);
    expect((await request(server, tab, 'DELETE', apiPath(API_ROUTES.permissionRule, { wsId: workspace.id, ruleId: 'nope' }))).status).toBe(404);

    expect((await decide(server, tab, workspace.id, session.id, payload.requestId, { decision: 'deny' })).status).toBe(204);
    await idle(server, session.id);
  });

  it('refuses Always allow (400, with the reason) for a command led by an interpreter or wrapper', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    for (const command of ['sudo npm test', 'bash -c ls', 'FOO=1 npm test']) {
      const { payload } = await ask(server, tab, workspace.id, session.id, `permission ${command}`);
      expect(payload.alwaysAllowScope).toBeNull();
      const refused = await decide(server, tab, workspace.id, session.id, payload.requestId, { decision: 'allow_always' });
      expect(refused.status).toBe(400);
      expect(ApiErrorBody.parse(await refused.json()).error.message).toMatch(/^Always allow isn't offered for /);
      expect(stateOf(server, session.id)).toBe('waiting');
      expect((await decide(server, tab, workspace.id, session.id, payload.requestId, { decision: 'deny' })).status).toBe(204);
      await idle(server, session.id);
    }
    expect(PermissionRulesResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.permissionRules, { wsId: workspace.id }))).json()).rules).toEqual([]);
  });

  it('an edit rule covers edits inside the project only', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    const first = await ask(server, tab, workspace.id, session.id, 'permission-edit src/a.ts');
    expect(first.payload.alwaysAllowScope).toEqual({ kind: 'tool', value: 'edit', label: 'Editing files' });
    expect((await decide(server, tab, workspace.id, session.id, first.payload.requestId, { decision: 'allow_always' })).status).toBe(204);
    await idle(server, session.id);

    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: session.id }), { text: 'permission-edit src/b.ts' })).status).toBe(202);
    await waitFor(() => replies(server, session.id).length === 2, 'the second reply', 15_000);
    await idle(server, session.id);
    expect(replies(server, session.id)).toEqual(['Edited src/a.ts.', 'Edited src/b.ts.']);

    const outside = await ask(server, tab, workspace.id, session.id, 'permission-edit src/c.ts|../elsewhere.txt');
    expect((await decide(server, tab, workspace.id, session.id, outside.payload.requestId, { decision: 'deny' })).status).toBe(204);
    await idle(server, session.id);
    expect(replies(server, session.id).at(-1)).toBe('Denied src/c.ts, ../elsewhere.txt.');
  });

  it('every route needs the tab token (401) and a matching Origin to change state (403)', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    const routes: Array<[string, string]> = [
      ['POST', apiPath(API_ROUTES.sessionPermission, { wsId: workspace.id, sesId: session.id, requestId: 'preq_1' })],
      ['GET', apiPath(API_ROUTES.permissionRules, { wsId: workspace.id })],
      ['DELETE', apiPath(API_ROUTES.permissionRule, { wsId: workspace.id, ruleId: 'rule_01J9Z3K4M5N6P7Q8R9S0T1V2W3' })],
    ];
    for (const [method, path] of routes) {
      const anonymous = await fetch(`${server.url}${path}`, { method, headers: { origin: tab.origin, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{"decision":"allow_once"}' } : {}) });
      expect(anonymous.status, `${method} ${path}`).toBe(401);
      if (method === 'GET') continue;
      const foreign = await fetch(`${server.url}${path}`, {
        method,
        headers: { authorization: tab.headers.authorization!, origin: 'http://evil.example', 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{"decision":"allow_once"}' } : {}),
      });
      expect(foreign.status, `${method} ${path}`).toBe(403);
    }
  });

  it('a pending request is cancelled when the server stops, and the agent never runs it', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    const { payload } = await ask(server, tab, workspace.id, session.id, 'permission');
    const core = server.core;
    const seen: CoreEvent[] = [];
    core.events.subscribe(core.events.lastSeq(), (e) => seen.push(e));
    await server.close();
    expect(seen.find((e) => e.type === 'permission.resolved')?.payload).toMatchObject({ requestId: payload.requestId, by: 'cancelled' });
    expect(seen.some((e) => e.type === 'session.message_completed' && e.payload.content.startsWith('Ran'))).toBe(false);
  });
});
