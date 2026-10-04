/**
 * Chats persist and resume after a restart (story 2.7), end to end: two real
 * servers on one data folder, the real `acp-claude-code` adapter, and the
 * fake ACP agent in each of its `FAKE_ACP_RESUME` modes. The fake's
 * `context` reply says how the session was reopened (`via`) and how many
 * earlier messages core primed it with (`primed`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_SESSION_REF } from '@ogden-agents/core';
import { API_ROUTES, apiPath, SessionResponse, WorkspaceResponse, type CoreEvent, type SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

const repos: string[] = [];
const servers: TestServer[] = [];
// Servers first (closing one stops its agents), then the repo folders: on
// Windows a folder can't be removed while a process has it as its working directory.
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-repo-'));
  repos.push(dir);
  return dir;
}

async function startServer(dataDir: string, resume: string, lines: string[] = []) {
  const server = await startTestServer({ dataDir, claudeAdapterPath: FAKE_AGENT, extraAgentEnv: { FAKE_ACP_RESUME: resume }, lines });
  servers.push(server);
  return { server, tab: await signIn(server) };
}

function post(server: TestServer, tab: SignedIn, path: string, body: unknown) {
  return fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { ...tab.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function openChat(server: TestServer, tab: SignedIn) {
  const { workspace } = WorkspaceResponse.parse(await (await post(server, tab, API_ROUTES.workspaces, { path: repo() })).json());
  const { session } = SessionResponse.parse(await (await post(server, tab, apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
  return { workspace, session };
}

const sessionEventsOf = (server: TestServer, sessionId: SessionId): CoreEvent[] => server.core.events.readAfter(0).filter((e) => e.streamId === sessionId);
const replies = (server: TestServer, sessionId: SessionId) =>
  sessionEventsOf(server, sessionId).flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));

/** Sends `text` and waits for the reply to complete and the session to settle. */
async function ask(server: TestServer, tab: SignedIn, wsId: string, sesId: SessionId, text: string) {
  const before = replies(server, sesId).length;
  expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text })).status).toBe(202);
  await waitFor(
    () => {
      const state = server.core.entities.getSession(sesId)!.state;
      return state === 'error' || (state === 'idle' && replies(server, sesId).length > before);
    },
    `the reply to ${text}`,
    15_000,
  );
  return replies(server, sesId).at(-1);
}

describe('a chat after a restart (story 2.7)', () => {
  it.each([
    ['resume', 'resumed', 'resumed', 0],
    ['load', 'loaded', 'loaded', 0],
    ['none', 'new', 'transcript', 2],
  ] as const)('FAKE_ACP_RESUME=%s: the next message reopens it (via=%s), marks the break (%s), and primes %i messages', async (mode, via, marker, primed) => {
    const dataDir = tempDataDir();
    const first = await startServer(dataDir, mode);
    const { workspace, session } = await openChat(first.server, first.tab);
    expect(await ask(first.server, first.tab, workspace.id, session.id, 'hello')).toBe('Hello from the fake agent.');
    const ref = first.server.core.entities.getSession(session.id)!.adapterRefs[AGENT_SESSION_REF]!;
    expect(ref).toMatch(/^fake-session-/);
    // AD-9: the agent's id is stored as a ref, never in the log.
    expect(JSON.stringify(first.server.core.events.readAfter(0))).not.toContain(ref);
    await first.server.close();

    const lines: string[] = [];
    const second = await startServer(dataDir, mode, lines);
    // A server start spawns no agent: reopening waits for the next message.
    expect(lines.some((line) => line.includes('starting the Claude Code adapter'))).toBe(false);

    const reply = await ask(second.server, second.tab, workspace.id, session.id, 'context');
    const now = second.server.core.entities.getSession(session.id)!;
    expect(now.state).toBe('idle');
    const id = now.adapterRefs[AGENT_SESSION_REF]!;
    expect(reply).toBe(`session=${id} via=${via} primed=${primed}`);
    // Resumed and loaded sessions keep the ref; a new one replaces it (the fake numbers its sessions per process, so only the reply tells).
    if (mode !== 'none') expect(id).toBe(ref);

    const events = sessionEventsOf(second.server, session.id);
    const resumed = events.filter((e) => e.type === 'session.resumed');
    expect(resumed.map((e) => e.payload)).toEqual([{ sessionId: session.id, via: marker }]);
    // The marker sits after the message that reopened the chat, which stays the user's own text.
    const at = events.indexOf(resumed[0]!);
    const lastUser = events.slice(0, at).findLast((e) => e.type === 'session.message_completed' && e.payload.role === 'user');
    expect(lastUser).toMatchObject({ payload: { content: 'context' } });
    // The load's replayed history was not reported again.
    expect(replies(second.server, session.id)).toEqual(['Hello from the fake agent.', reply]);
    // No event carries the agent's id, apart from the fake's own `context` reply that quotes it.
    const others = second.server.core.events.readAfter(0).filter((e) => !(e.type === 'session.message_completed' && e.payload.content === reply));
    expect(JSON.stringify(others)).not.toContain(id);
    expect(JSON.stringify(others)).not.toContain(ref);
    // The log has no transcript text.
    expect(lines.join('\n')).not.toContain('Hello from the fake agent.');
  });

  it('a slash command right after a transcript reopen reaches the agent as it is; the next message is primed (review F1)', async () => {
    const dataDir = tempDataDir();
    const first = await startServer(dataDir, 'none');
    const { workspace, session } = await openChat(first.server, first.tab);
    await ask(first.server, first.tab, workspace.id, session.id, 'hello');
    await first.server.close();

    const second = await startServer(dataDir, 'none');
    expect(await ask(second.server, second.tab, workspace.id, session.id, '/compact')).toBe('command=/compact primed=0');
    // hello, its reply, /compact and its reply.
    expect(await ask(second.server, second.tab, workspace.id, session.id, 'context')).toMatch(/ via=new primed=4$/);
    expect(await ask(second.server, second.tab, workspace.id, session.id, 'context')).toMatch(/ via=new primed=0$/);
  });

  it('an agent that crashed in this run is reopened by the next message', async () => {
    const { server, tab } = await startServer(tempDataDir(), 'resume');
    const { workspace, session } = await openChat(server, tab);
    await ask(server, tab, workspace.id, session.id, 'crash');
    expect(server.core.entities.getSession(session.id)!.state).toBe('error');
    const ref = server.core.entities.getSession(session.id)!.adapterRefs[AGENT_SESSION_REF]!;
    expect(await ask(server, tab, workspace.id, session.id, 'context')).toBe(`session=${ref} via=resumed primed=0`);
    expect(sessionEventsOf(server, session.id).filter((e) => e.type === 'session.resumed').map((e) => e.payload.via)).toEqual(['resumed']);
  });

  it('a reopen that fails leaves the session in error, not working', async () => {
    const dataDir = tempDataDir();
    const first = await startServer(dataDir, 'resume');
    const { workspace, session } = await openChat(first.server, first.tab);
    await ask(first.server, first.tab, workspace.id, session.id, 'hello');
    await first.server.close();

    const second = await startTestServer({ dataDir, claudeAdapterPath: FAKE_AGENT, extraAgentEnv: { FAKE_ACP_RESUME: 'resume', FAKE_ACP_REOPEN_FAIL: 'resume-auth' } });
    servers.push(second);
    const tab = await signIn(second);
    expect((await post(second, tab, apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: session.id }), { text: 'hello?' })).status).toBe(202);
    await waitFor(() => second.core.entities.getSession(session.id)!.state === 'error', 'error', 15_000);
    expect(sessionEventsOf(second, session.id).at(-1)).toMatchObject({ payload: { state: 'error', reason: 'Claude Code needs you to sign in again.' } });
    expect(sessionEventsOf(second, session.id).some((e) => e.type === 'session.resumed')).toBe(false);
  });
});
