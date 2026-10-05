/**
 * Epic 14 story 14.9: BMad Method reaches the Local model where Planning is
 * on, and nothing where it is off. A real server with Claude Code (the fake
 * ACP agent), the Local model in its wiring slot (the fake OpenCode talking to
 * the fake OpenAI-compatible server) and a memory catalog:
 *
 * - a project whose default agent is the Local model starts its planning
 *   sessions with it, the first message in its own skill syntax (`/bmad-spec
 *   idea`, a slash command), and it answers;
 * - Set up places the skills in `.agents/skills` (the Local model's folder,
 *   from its descriptor) while it is in use and Planning is on; with only
 *   Board on, or Claude Code alone, `.claude/skills` only, as before;
 * - the harness reads `.agents/skills` and never `.claude/skills` or the home
 *   folder's skills (the other agents' folders do not leak in);
 * - in a Simple project (every BMad piece off) a Local model chat gets no BMad
 *   text from Ogden, and nothing is written to the repo.
 *
 * No test runs the real harness, a real model or the real network.
 */
import { mkdirSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAgent, createMemoryAgentSetup, createMemoryBmadCatalog, type MemoryBmadCatalog } from '@ogden-agents/adapters';
import { API_ROUTES, apiPath, SessionResponse, WorkspaceResponse, type BmadPiece, type SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_OPENCODE = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-opencode.mjs');
const servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A server with the Local model on a fake endpoint, a memory catalog where `repo` has `bmad-spec`, and that repo with `pieces` on. */
async function setUp(pieces: BmadPiece[], { defaultAgent }: { defaultAgent?: string } = {}) {
  const fake = await startFakeServer();
  servers.push(fake);
  const dataDir = tempDataDir();
  const repo = temp('ogden-agents-local-plan-repo-');
  const real = realpathSync.native(repo);
  const bmadCatalog: MemoryBmadCatalog = createMemoryBmadCatalog({}, { [real]: [{ name: 'bmad-spec', description: 'Condense any input into a short spec.' }] });
  const local = {
    agent: createLocalAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_OPENCODE] }) }),
    setup: createMemoryAgentSetup({ agentId: 'local', displayName: 'Local model', installed: true, auth: 'signed_in' }),
    target: async () => ({ baseUrl: `${fake.url}/v1` }),
  };
  const server = await startTestServer({ local, dataDir, bmadCatalog });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: pieces, ...(defaultAgent === undefined ? {} : { defaultAgentId: defaultAgent }) })).status).toBe(200);
  return { server, tab, wsId, bmadCatalog, repo, dataDir, fake };
}

const messagesOf = (server: TestServer, sessionId: SessionId, role: 'user' | 'agent') =>
  server.core.events.readAfter(0).flatMap((e) => (e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === role ? [e.payload.content] : []));

async function setUpBmad(server: TestServer, tab: SignedIn, wsId: string, bmadCatalog: MemoryBmadCatalog) {
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBmadSetup, { wsId }))).status).toBe(202);
  await waitFor(() => server.core.events.readAfter(0).some((e) => e.workspaceId === wsId && (e.type === 'bmad.setup_completed' || e.type === 'bmad.setup_failed')), 'the setup to end');
  return bmadCatalog.setupOptions.at(-1);
}

describe('BMad Method with the Local model where Planning is on (epic 14 story 14.9)', () => {
  it("starts a planning session with the project's default agent, the Local model, in its own skill syntax, and it runs the skill end to end", async () => {
    const { server, tab, wsId, repo } = await setUp(['planning'], { defaultAgent: 'local' });
    // Set up has put the skill where the harness reads it.
    mkdirSync(join(repo, '.agents', 'skills', 'bmad-spec'), { recursive: true });
    const started = await request(server, tab, 'POST', apiPath(API_ROUTES.workspacePlanningSessions, { wsId }), { skill: 'bmad-spec', idea: 'a habit tracker' });
    expect(started.status).toBe(201);
    const { session } = SessionResponse.parse(await started.json());
    expect(session).toMatchObject({ kind: 'planning', agentId: 'local' });
    expect(messagesOf(server, session.id, 'user')).toEqual(['/bmad-spec a habit tracker']);
    await waitFor(() => server.core.entities.getSession(session.id)!.state === 'idle' && messagesOf(server, session.id, 'agent').length > 0, "the Local model's reply", 15_000);
    // The harness lists the skill as a command and ran it as one: found, not merely relayed.
    expect(messagesOf(server, session.id, 'agent')[0]).toBe('command=/bmad-spec a habit tracker found=true');
  });

  it('Set up places the skills in .agents/skills too while the Local model is in use, by default or by a chat', async () => {
    const byDefault = await setUp(['planning'], { defaultAgent: 'local' });
    expect(await setUpBmad(byDefault.server, byDefault.tab, byDefault.wsId, byDefault.bmadCatalog)).toEqual({ skillFolders: ['.agents/skills'] });
    const byChat = await setUp(['planning']);
    expect((await request(byChat.server, byChat.tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: byChat.wsId }), { agentId: 'local' })).status).toBe(201);
    expect(await setUpBmad(byChat.server, byChat.tab, byChat.wsId, byChat.bmadCatalog)).toEqual({ skillFolders: ['.agents/skills'] });
  });

  it('Set up keeps to .claude/skills with Claude Code alone, or with only Board on', async () => {
    const claudeOnly = await setUp(['planning']);
    expect(await setUpBmad(claudeOnly.server, claudeOnly.tab, claudeOnly.wsId, claudeOnly.bmadCatalog)).toEqual({});
    const boardOnly = await setUp(['board'], { defaultAgent: 'local' });
    expect(await setUpBmad(boardOnly.server, boardOnly.tab, boardOnly.wsId, boardOnly.bmadCatalog)).toEqual({});
  });

  it('the harness sees the skills in .agents/skills, and not the Claude folder or the home folder (the other agents\' folders do not leak in)', async () => {
    const { server, tab, wsId, repo, dataDir } = await setUp(['planning'], { defaultAgent: 'local' });
    mkdirSync(join(repo, '.agents', 'skills', 'bmad-spec'), { recursive: true });
    mkdirSync(join(repo, '.claude', 'skills', 'claude-only-skill'), { recursive: true });
    // Its own home is empty and inside the data folder: a skill planted there is never read from a real home.
    mkdirSync(join(dataDir, 'agents', 'local-home', 'home', '.claude', 'skills', 'home-skill'), { recursive: true });
    const { session } = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'local' })).json());
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'skills' })).status).toBe(202);
    await waitFor(() => messagesOf(server, session.id, 'agent').length > 0, "the Local model's reply", 15_000);
    expect(messagesOf(server, session.id, 'agent')[0]).toBe('skills=project-agents:bmad-spec');
  });

  it('a Simple project (every BMad piece off): a Local model chat gets no BMad text from Ogden, and the repo is untouched', async () => {
    const { server, tab, wsId, repo, fake, dataDir } = await setUp([], { defaultAgent: 'local' });
    const before = readdirSync(repo).sort();
    const { session } = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'local' })).json());
    // What the harness itself received: the whole first prompt and how its session was opened.
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'session-start' })).status).toBe(202);
    await waitFor(() => messagesOf(server, session.id, 'agent').length > 0, "the Local model's reply", 15_000);
    const started = messagesOf(server, session.id, 'agent')[0]!;
    expect(started).toContain('meta=none');
    expect(started).toContain('prompt="session-start"');
    expect(started).not.toMatch(/bmad/i);
    expect(messagesOf(server, session.id, 'user')).toEqual(['session-start']);
    // It runs in the empty home inside the data folder, and nothing named BMad reached the model's server.
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'env-report' })).status).toBe(202);
    await waitFor(() => messagesOf(server, session.id, 'agent').length > 1, 'the environment report', 15_000);
    expect((JSON.parse(messagesOf(server, session.id, 'agent')[1]!) as { folders: { HOME: string } }).folders.HOME).toBe(join(dataDir, 'agents', 'local-home', 'home'));
    expect(JSON.stringify(fake.log)).not.toMatch(/bmad/i);
    expect(readdirSync(repo).sort()).toEqual(before);
    // Planning is refused while its piece is off.
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.workspacePlanningSessions, { wsId }), { skill: 'bmad-spec' })).status).toBeGreaterThanOrEqual(400);
  });
});
