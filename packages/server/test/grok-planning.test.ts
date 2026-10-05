/**
 * Epic 12 entry 9 for Grok: BMad Method reaches Grok where Planning is on,
 * and nothing where it is off. A real server with Claude Code (the fake ACP
 * agent) and Grok in its wiring slot (the fake's Grok personality) and a
 * memory catalog:
 *
 * - a project whose default agent is Grok starts its planning sessions with
 *   Grok, the first message in Grok's own skill syntax (`/bmad-spec idea`: it
 *   lists `.claude/skills` as slash commands), and Grok answers it;
 * - Grok reads `.claude/skills`, where Set up already places the skills for
 *   Claude Code, so using Grok adds no folder (its descriptor's `skillsFolder`);
 * - Grok's own folder trust would skip a project's skills, so its process is
 *   started with it off (the project is trusted in Ogden first): a skill in
 *   `.claude/skills` is seen by Grok;
 * - in a Simple project (every BMad piece off) a Grok chat gets no BMad text
 *   from Ogden, and nothing is written to the repo.
 *
 * No test runs the real Grok, reads `~/.grok` or reaches xAI.
 */
import { mkdirSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGrokAgent, createMemoryAgentSetup, createMemoryBmadCatalog, type MemoryBmadCatalog } from '@ogden-agents/adapters';
import type { AgentSetupPort } from '@ogden-agents/core';
import { API_ROUTES, apiPath, SessionResponse, WorkspaceResponse, type BmadPiece, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { GrokPorts } from '../src/grok-wiring.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_GROK = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-grok.mjs');
const KEY = `xai-${'P'.repeat(60)}2468`;

const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

/** Grok's ports: the chat port on the fake, and a setup that is installed and signed out, so its token (the server's environment) is used. */
function grok(): GrokPorts {
  const base = createMemoryAgentSetup({ agentId: 'grok', displayName: 'Grok', installed: true, auth: 'needs_sign_in' });
  const setup: AgentSetupPort = {
    ...base,
    status: async () => ({ ...(await base.status()), subscription: 'signed_out' }),
    apiKey: { envName: 'XAI_API_KEY', check: () => undefined, verify: async () => 'ok' },
  };
  return { agent: createGrokAgent({ dataDir: temp('ogden-agents-grok-plan-'), server: () => ({ command: process.execPath, args: [FAKE_GROK] }) }), setup };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A server with Grok, a memory catalog where `repo` has `bmad-spec`, and that repo as a trusted project with `pieces` on. */
async function setUp(pieces: BmadPiece[], { defaultAgent }: { defaultAgent?: string } = {}) {
  const repo = temp('ogden-agents-grok-plan-repo-');
  const real = realpathSync.native(repo);
  const bmadCatalog: MemoryBmadCatalog = createMemoryBmadCatalog({}, { [real]: [{ name: 'bmad-spec', description: 'Condense any input into a short spec.' }] });
  const server = await startTestServer({ grok: grok(), bmadCatalog, extraAgentEnv: { XAI_API_KEY: KEY } });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const settings = apiPath(API_ROUTES.workspaceSettings, { wsId });
  expect((await request(server, tab, 'PATCH', settings, { bmadPieces: pieces, ...(defaultAgent === undefined ? {} : { defaultAgentId: defaultAgent }) })).status).toBe(200);
  // Grok runs the project's own files, so a chat with it starts only in a trusted project.
  expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
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

describe('BMad Method with Grok where Planning is on (epic 12 entry 9)', () => {
  it("starts a planning session with the project's default agent, Grok, in its own skill syntax", async () => {
    const { server, tab, wsId } = await setUp(['planning'], { defaultAgent: 'grok' });
    const started = await request(server, tab, 'POST', apiPath(API_ROUTES.workspacePlanningSessions, { wsId }), { skill: 'bmad-spec', idea: 'a habit tracker' });
    expect(started.status).toBe(201);
    const { session } = SessionResponse.parse(await started.json());
    expect(session).toMatchObject({ kind: 'planning', agentId: 'grok' });
    expect(messagesOf(server, session.id, 'user')).toEqual(['/bmad-spec a habit tracker']);
    await waitFor(() => server.core.entities.getSession(session.id)!.state === 'idle' && messagesOf(server, session.id, 'agent').length > 0, "Grok's reply", 15_000);
  });

  it('Set up needs no extra folder for Grok: it reads .claude/skills, where the skills already go', async () => {
    const byDefault = await setUp(['planning'], { defaultAgent: 'grok' });
    expect(await setUpBmad(byDefault.server, byDefault.tab, byDefault.wsId, byDefault.bmadCatalog)).toEqual({});
    const byChat = await setUp(['planning']);
    expect((await request(byChat.server, byChat.tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: byChat.wsId }), { agentId: 'grok' })).status).toBe(201);
    expect(await setUpBmad(byChat.server, byChat.tab, byChat.wsId, byChat.bmadCatalog)).toEqual({});
  });

  it('a skill in .claude/skills reaches Grok, because its own folder trust is off for a project Ogden trusted', async () => {
    const { server, tab, wsId, repo } = await setUp(['planning'], { defaultAgent: 'grok' });
    mkdirSync(join(repo, '.claude', 'skills', 'bmad-spec'), { recursive: true });
    const chat = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'grok' });
    const { session } = SessionResponse.parse(await chat.json());
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'skills' })).status).toBe(202);
    await waitFor(() => messagesOf(server, session.id, 'agent').length > 0, "Grok's reply", 15_000);
    expect(messagesOf(server, session.id, 'agent')[0]).toBe('skills=bmad-spec');
  });

  it('a Simple project (every BMad piece off): a Grok chat gets no BMad text from Ogden, and the repo is untouched', async () => {
    const { server, tab, wsId, repo } = await setUp([], { defaultAgent: 'grok' });
    const before = readdirSync(repo).sort();
    const chat = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'grok' });
    expect(chat.status).toBe(201);
    const { session } = SessionResponse.parse(await chat.json());
    const send = await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'session-start' });
    expect(send.status).toBe(202);
    await waitFor(() => messagesOf(server, session.id, 'agent').length > 0, "Grok's reply", 15_000);
    const started = JSON.parse(messagesOf(server, session.id, 'agent')[0]!) as { prompt: string; meta: unknown };
    expect(started.prompt).not.toMatch(/bmad/i);
    expect(readdirSync(repo).sort()).toEqual(before);
    // Planning is refused while its piece is off.
    const planning = await request(server, tab, 'POST', apiPath(API_ROUTES.workspacePlanningSessions, { wsId }), { skill: 'bmad-spec' });
    expect(planning.status).toBeGreaterThanOrEqual(400);
  });
});
