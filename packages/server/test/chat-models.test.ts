/**
 * Story 11 over HTTP, against the real server and the fake ACP agent (which
 * lists `fake-default`, `fake-large`, `fake-small` and `fake-locked` as its
 * session's model config option): `GET` session's `models`, `PUT` a chat's
 * model (applied to the next message), its refusals, a chat created with a
 * model, and an agent's install-wide default model.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, ApiErrorBody, apiPath, ChatAgentsResponse, SessionResponse, WorkspaceResponse, type CoreEvent, type SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

const repos: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function startChatServer() {
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

async function openChat(server: TestServer, tab: SignedIn, body: unknown = {}, wsId?: string) {
  let workspaceId = wsId;
  if (workspaceId === undefined) {
    const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-repo-'));
    repos.push(repo);
    workspaceId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  }
  const response = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: workspaceId }), body);
  const { session } = SessionResponse.parse(await response.json());
  return { wsId: workspaceId, sesId: session.id, session };
}

const streamOf = (server: TestServer, sessionId: SessionId): CoreEvent[] => server.core.events.readAfter(0).filter((e) => e.streamId === sessionId);
const replies = (server: TestServer, sessionId: SessionId) =>
  streamOf(server, sessionId).flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));

async function say(server: TestServer, tab: SignedIn, ids: { wsId: string; sesId: SessionId }, text: string): Promise<string> {
  const before = replies(server, ids.sesId).length;
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, ids), { text })).status).toBe(202);
  await waitFor(() => server.core.entities.getSession(ids.sesId)!.state === 'idle' && replies(server, ids.sesId).length > before, `the reply to ${text}`, 15_000);
  return replies(server, ids.sesId).at(-1)!;
}

const readSession = async (server: TestServer, tab: SignedIn, ids: { wsId: string; sesId: string }) =>
  SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, ids))).json());
const setModel = (server: TestServer, tab: SignedIn, ids: { wsId: string; sesId: string }, body: unknown) => request(server, tab, 'PUT', apiPath(API_ROUTES.sessionModel, ids), body);
const refusalOf = async (response: Response) => ({ status: response.status, code: ApiErrorBody.parse(await response.json()).error.code });

describe('a chat model over HTTP (story 11)', () => {
  it('lists the agent models once it started, switches for the next message, and refuses what it must', async () => {
    const { server, tab } = await startChatServer();
    const ids = await openChat(server, tab);
    expect((await readSession(server, tab, ids)).models).toEqual({ available: null });
    expect(await say(server, tab, ids, 'model')).toBe('model=fake-default');
    const read = await readSession(server, tab, ids);
    expect(read.models?.available?.map((model) => model.id)).toEqual(['fake-default', 'fake-large', 'fake-small', 'fake-locked']);
    expect(read.models?.current).toBe('fake-default');

    const changed = await setModel(server, tab, ids, { model: 'fake-large' });
    expect(changed.status).toBe(200);
    expect(SessionResponse.parse(await changed.json()).session.model).toBe('fake-large');
    expect(await say(server, tab, ids, 'model')).toBe('model=fake-large');

    expect(await refusalOf(await setModel(server, tab, ids, { model: 'fake-huge' }))).toEqual({ status: 409, code: 'model_unavailable' });
    expect((await setModel(server, tab, ids, { model: '--evil' })).status).toBe(400);
    const events = streamOf(server, ids.sesId).filter((e) => e.type === 'session.model_changed');
    expect(events.map((e) => (e.type === 'session.model_changed' ? [e.payload.previous, e.payload.model, e.payload.cause] : []))).toEqual([[null, 'fake-large', 'user']]);
  });

  it('a model the agent refuses moves the chat to its default with the agent words, and the reply still comes', async () => {
    const { server, tab } = await startChatServer();
    const ids = await openChat(server, tab, { model: 'fake-locked' });
    expect(ids.session.model).toBe('fake-locked');
    expect(await say(server, tab, ids, 'model')).toBe('model=fake-default');
    const change = streamOf(server, ids.sesId).find((e) => e.type === 'session.model_changed');
    expect(change?.type === 'session.model_changed' ? change.payload : undefined).toMatchObject({ model: null, previous: 'fake-locked', cause: 'agent' });
    expect(change?.type === 'session.model_changed' ? change.payload.reason : '').toContain("Your plan doesn't include Fake Locked.");
  });

  it('the install default model is set per agent, used by new chats, and an unknown agent is 404', async () => {
    const { server, tab } = await startChatServer();
    const { agents } = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json());
    const agentId = agents[0]!.agentId;
    const set = await request(server, tab, 'PUT', apiPath(API_ROUTES.chatAgentDefaultModel, { agentId }), { model: 'fake-small' });
    expect(set.status).toBe(200);
    expect(ChatAgentsResponse.parse(await set.json()).agents.find((agent) => agent.agentId === agentId)?.defaultModel).toBe('fake-small');
    const ids = await openChat(server, tab, { agentId });
    expect(ids.session.model).toBe('fake-small');
    expect(await say(server, tab, ids, 'model')).toBe('model=fake-small');
    // Once listed, the agent list carries the models for Settings.
    const listed = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json());
    expect(listed.agents.find((agent) => agent.agentId === agentId)?.models?.map((model) => model.id)).toContain('fake-large');
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.chatAgentDefaultModel, { agentId: 'no-such-agent' }), { model: null })).status).toBe(404);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.chatAgentDefaultModel, { agentId }), { model: '' })).status).toBe(400);
  });
});
