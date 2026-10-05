/**
 * Epic 12 entry 9 for Codex: BMad Method reaches Codex where Planning is on,
 * and nothing where it is off. A real server with Claude Code (the fake ACP
 * agent) and Codex in its wiring slot (the fake's Codex personality) and a
 * memory catalog:
 *
 * - a project whose default agent is Codex starts its planning sessions with
 *   Codex, the first message in Codex's own skill syntax (`$bmad-spec idea`),
 *   and Codex answers it;
 * - Set up places the skills in `.agents/skills` (Codex's folder, from its
 *   descriptor) when Codex is in use (its default, or one of its chats) and
 *   Planning is on; with only Board on, or with Claude Code alone, `.claude/skills`
 *   only, as before;
 * - in a Simple project (every BMad piece off) a Codex chat gets no BMad text
 *   from Ogden, and nothing is written to the repo.
 *
 * No test runs the real Codex, reads `~/.codex` or reaches OpenAI.
 */
import { mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexAgent, createMemoryAgentSetup, createMemoryBmadCatalog, type MemoryBmadCatalog } from '@ogden-agents/adapters';
import type { AgentSetupPort } from '@ogden-agents/core';
import { API_ROUTES, apiPath, SessionResponse, WorkspaceResponse, type BmadPiece, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { CodexPorts } from '../src/codex-wiring.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_CODEX = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-codex.mjs');
const KEY = `sk-proj-${'P'.repeat(40)}2468`;

const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

/** Codex's ports: the chat port on the fake, and a setup that is installed and signed out, so its key (the server's environment) is used. */
function codex(): CodexPorts {
  const base = createMemoryAgentSetup({ agentId: 'codex', displayName: 'Codex', installed: true, auth: 'needs_sign_in' });
  const setup: AgentSetupPort = {
    ...base,
    status: async () => ({ ...(await base.status()), subscription: 'signed_out' }),
    apiKey: { envName: 'CODEX_API_KEY', check: () => undefined, verify: async () => 'ok' },
  };
  return { agent: createCodexAgent({ dataDir: temp('ogden-agents-codex-plan-'), server: () => ({ command: process.execPath, args: [FAKE_CODEX] }) }), setup };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A server with Codex, a memory catalog where `repo` has `bmad-spec`, and that repo as a project with `pieces` on. */
async function setUp(pieces: BmadPiece[], { defaultAgent }: { defaultAgent?: string } = {}) {
  const repo = temp('ogden-agents-codex-plan-repo-');
  const real = realpathSync.native(repo);
  const bmadCatalog: MemoryBmadCatalog = createMemoryBmadCatalog({}, { [real]: [{ name: 'bmad-spec', description: 'Condense any input into a short spec.' }] });
  const server = await startTestServer({ codex: codex(), bmadCatalog, extraAgentEnv: { CODEX_API_KEY: KEY } });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const settings = apiPath(API_ROUTES.workspaceSettings, { wsId });
  expect((await request(server, tab, 'PATCH', settings, { bmadPieces: pieces, ...(defaultAgent === undefined ? {} : { defaultAgentId: defaultAgent }) })).status).toBe(200);
  return { server, tab, wsId, bmadCatalog, repo };
}

const messagesOf = (server: TestServer, sessionId: SessionId, role: 'user' | 'agent') =>
  server.core.events
    .readAfter(0)
    .flatMap((e) => (e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === role ? [e.payload.content] : []));

/** Runs Set up and waits for it to end; the options the catalog's setup was given. */
async function setUpBmad(server: TestServer, tab: SignedIn, wsId: string, bmadCatalog: MemoryBmadCatalog) {
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBmadSetup, { wsId }))).status).toBe(202);
  await waitFor(() => server.core.events.readAfter(0).some((e) => e.workspaceId === wsId && (e.type === 'bmad.setup_completed' || e.type === 'bmad.setup_failed')), 'the setup to end');
  return bmadCatalog.setupOptions.at(-1);
}

describe('BMad Method with Codex where Planning is on (epic 12 entry 9)', () => {
  it("starts a planning session with the project's default agent, Codex, in its own skill syntax", async () => {
    const { server, tab, wsId } = await setUp(['planning'], { defaultAgent: 'codex' });
    const started = await request(server, tab, 'POST', apiPath(API_ROUTES.workspacePlanningSessions, { wsId }), { skill: 'bmad-spec', idea: 'a habit tracker' });
    expect(started.status).toBe(201);
    const { session } = SessionResponse.parse(await started.json());
    expect(session).toMatchObject({ kind: 'planning', agentId: 'codex' });
    expect(messagesOf(server, session.id, 'user')).toEqual(['$bmad-spec a habit tracker']);
    await waitFor(() => server.core.entities.getSession(session.id)!.state === 'idle' && messagesOf(server, session.id, 'agent').length > 0, "Codex's reply", 15_000);
  });

  it('Set up places the skills in .agents/skills too while Codex is in use, by default or by a chat', async () => {
    const byDefault = await setUp(['planning'], { defaultAgent: 'codex' });
    expect(await setUpBmad(byDefault.server, byDefault.tab, byDefault.wsId, byDefault.bmadCatalog)).toEqual({ skillFolders: ['.agents/skills'] });

    const byChat = await setUp(['planning']);
    const chat = await request(byChat.server, byChat.tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: byChat.wsId }), { agentId: 'codex' });
    expect(chat.status).toBe(201);
    expect(await setUpBmad(byChat.server, byChat.tab, byChat.wsId, byChat.bmadCatalog)).toEqual({ skillFolders: ['.agents/skills'] });
  });

  it('Set up keeps to .claude/skills with Claude Code alone, or with only Board on', async () => {
    const claudeOnly = await setUp(['planning']);
    expect(await setUpBmad(claudeOnly.server, claudeOnly.tab, claudeOnly.wsId, claudeOnly.bmadCatalog)).toEqual({});

    const boardOnly = await setUp(['board'], { defaultAgent: 'codex' });
    expect(await setUpBmad(boardOnly.server, boardOnly.tab, boardOnly.wsId, boardOnly.bmadCatalog)).toEqual({});
  });

  it('a Simple project (every BMad piece off): a Codex chat gets no BMad text from Ogden, and the repo is untouched', async () => {
    const { server, tab, wsId, repo } = await setUp([], { defaultAgent: 'codex' });
    const before = readdirSync(repo).sort();
    const chat = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'codex' });
    expect(chat.status).toBe(201);
    const { session } = SessionResponse.parse(await chat.json());
    const send = await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'session-start' });
    expect(send.status).toBe(202);
    await waitFor(() => messagesOf(server, session.id, 'agent').length > 0, "Codex's reply", 15_000);
    const started = JSON.parse(messagesOf(server, session.id, 'agent')[0]!) as { prompt: string; meta: unknown };
    expect(started.prompt).not.toMatch(/bmad/i);
    expect(readdirSync(repo).sort()).toEqual(before);
    // Planning is refused while its piece is off.
    const planning = await request(server, tab, 'POST', apiPath(API_ROUTES.workspacePlanningSessions, { wsId }), { skill: 'bmad-spec' });
    expect(planning.status).toBeGreaterThanOrEqual(400);
  });
});

