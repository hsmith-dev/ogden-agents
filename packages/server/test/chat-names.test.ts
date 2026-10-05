/**
 * Chat names (backlog story 12) through the API: a real server with the fake
 * ACP agent. The first message names the chat; `PUT .../title` renames it,
 * normalized and capped by the server whatever the UI sends; a refusal
 * records no event; renaming works while the terminal drives; a start names
 * older chats.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, ApiErrorBody, apiPath, CHAT_NAME_TOO_LONG, SessionResponse, SessionsResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

const repos: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function start(dataDir = tempDataDir()) {
  const server = await startTestServer({ claudeAdapterPath: FAKE_AGENT, dataDir });
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
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const { session } = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), {})).json());
  return { wsId, sesId: session.id };
}

const rename = (server: TestServer, tab: SignedIn, ids: { wsId: string; sesId: string }, title: unknown) => request(server, tab, 'PUT', apiPath(API_ROUTES.sessionTitle, ids), { title });
const renames = (server: TestServer, sesId: SessionId) => server.core.events.readAfter(0).filter((event) => event.type === 'session.renamed' && event.streamId === sesId);

describe('chat names through the API', () => {
  it('the first message names the chat, and the list shows it', async () => {
    const { server, tab } = await start();
    const ids = await openChat(server, tab);
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, ids), { text: 'Plan the   pottery\nsite' })).status).toBe(202);
    await waitFor(() => server.core.entities.getSession(ids.sesId)?.autoTitle !== undefined, 'the automatic name');
    const listed = SessionsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSessions, ids))).json());
    expect(listed.sessions[0]).toMatchObject({ title: null, autoTitle: 'Plan the pottery site' });
    await waitFor(() => server.core.entities.getSession(ids.sesId)?.state === 'idle', 'the reply');
  });

  it('renames with control characters removed, clears with a blank name, and refuses one too long', async () => {
    const { server, tab } = await start();
    const ids = await openChat(server, tab);
    const renamed = await rename(server, tab, ids, ' Auth\u0000 ‮work\n ');
    expect(renamed.status).toBe(200);
    expect(SessionResponse.parse(await renamed.json()).session.title).toBe('Auth work');
    expect(renames(server, ids.sesId)).toHaveLength(1);

    const tooLong = await rename(server, tab, ids, 'x'.repeat(81));
    expect(tooLong.status).toBe(400);
    expect(ApiErrorBody.parse(await tooLong.json()).error).toMatchObject({ code: 'invalid_request', message: CHAT_NAME_TOO_LONG });
    expect((await rename(server, tab, ids, 'x'.repeat(5000))).status).toBe(400);
    expect((await rename(server, tab, ids, 42)).status).toBe(400);
    expect(renames(server, ids.sesId)).toHaveLength(1);

    expect(SessionResponse.parse(await (await rename(server, tab, ids, '  ')).json()).session.title).toBeNull();
    expect(server.core.entities.getSession(ids.sesId)?.title).toBeNull();
  });

  it('renames while the terminal drives, and a chat of another project is not found', async () => {
    const { server, tab } = await start();
    const ids = await openChat(server, tab);
    const other = await openChat(server, tab);
    server.core.entities.setSessionDriver(ids.sesId, 'terminal');
    expect((await rename(server, tab, ids, 'Still mine')).status).toBe(200);
    expect((await rename(server, tab, { wsId: other.wsId, sesId: ids.sesId }, 'Not here')).status).toBe(404);
    expect(server.core.entities.getSession(ids.sesId)?.title).toBe('Still mine');
  });

  it('a start names the chats from before chat names', async () => {
    const dataDir = tempDataDir();
    const first = await start(dataDir);
    const ids = await openChat(first.server, first.tab);
    // As stored before chat names: a user message, and no automatic name.
    first.server.core.sessionEvents.appendSessionEvent(ids.sesId, { type: 'session.message_completed', payload: { messageId: 'msg_old', role: 'user', content: 'An old question' } });
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    const second = await start(dataDir);
    expect(second.server.core.entities.getSession(ids.sesId)?.autoTitle).toBe('An old question');
  });
});
