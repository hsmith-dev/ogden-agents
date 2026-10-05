/**
 * Epic 6 entry 8 at the 4.13 restack: BMad Method reaches Antigravity where
 * Planning is on. A real server with Claude Code (the fake ACP agent) and
 * Antigravity in its wiring slot (the fake's Antigravity personality, its
 * pinned files planted as 6.7's Install leaves them), and a memory catalog:
 *
 * - a project whose default agent is Antigravity starts its planning
 *   sessions with Antigravity, the first message in Antigravity's own skill
 *   syntax (`AgentPort.skillInvocation`), and Antigravity answers it;
 * - Set up places the skills in `.agents/skills` too when Antigravity is in
 *   use (its default, or one of its chats) and Planning is on; with only
 *   Board on, or with Claude Code alone, `.claude/skills` only, as before.
 *
 * No test runs the real Antigravity server, reads `~/.gemini` or reaches Google.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANTIGRAVITY_PINS, createAntigravityAgent, createAntigravitySetup, createMemoryBmadCatalog, writeInstallRecord, type MemoryBmadCatalog } from '@ogden-agents/adapters';
import { API_ROUTES, apiPath, SessionResponse, WorkspaceResponse, type BmadPiece, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { AntigravityPorts } from '../src/antigravity-wiring.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_ANTIGRAVITY = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-antigravity.mjs');
const KEY = `AIza${'P'.repeat(31)}2468`;
const PINNED = ANTIGRAVITY_PINS.archives[`${process.platform}-${process.arch}` as keyof typeof ANTIGRAVITY_PINS.archives];

const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

/** Antigravity's ports on a data folder of their own, installed as 6.7's Install leaves it (the files are never run: the fake is). */
function antigravity(): AntigravityPorts {
  const dataDir = temp('ogden-agents-agy-plan-');
  if (PINNED !== undefined) {
    const folder = join(dataDir, 'agents', 'antigravity', ANTIGRAVITY_PINS.version);
    mkdirSync(folder, { recursive: true });
    for (const name of Object.keys(PINNED.files)) writeFileSync(join(folder, name), '');
    writeInstallRecord(folder, { version: ANTIGRAVITY_PINS.version, platform: `${process.platform}-${process.arch}`, reportedVersion: ANTIGRAVITY_PINS.version, files: Object.fromEntries(Object.keys(PINNED.files).map((name) => [name, 0])) });
  }
  return {
    agent: createAntigravityAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_ANTIGRAVITY, '--uid='] }) }),
    setup: createAntigravitySetup({ dataDir, apiKey: { verify: async () => 'ok' } }),
  };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A server with Antigravity, a memory catalog where `repo` has `bmad-spec`, and that repo as a project with `pieces` on. */
async function setUp(pieces: BmadPiece[], { defaultAgent }: { defaultAgent?: string } = {}) {
  const repo = temp('ogden-agents-agy-plan-repo-');
  const real = realpathSync.native(repo);
  const bmadCatalog: MemoryBmadCatalog = createMemoryBmadCatalog({}, { [real]: [{ name: 'bmad-spec', description: 'Condense any input into a short spec.' }] });
  const server = await startTestServer({ antigravity: antigravity(), bmadCatalog, extraAgentEnv: { GEMINI_API_KEY: KEY } });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const settings = apiPath(API_ROUTES.workspaceSettings, { wsId });
  expect((await request(server, tab, 'PATCH', settings, { bmadPieces: pieces, ...(defaultAgent === undefined ? {} : { defaultAgentId: defaultAgent }) })).status).toBe(200);
  return { server, tab, wsId, bmadCatalog };
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

describe.skipIf(PINNED === undefined)('BMad Method with Antigravity where Planning is on (epic 6 entry 8, 4.13 restack)', () => {
  it("starts a planning session with the project's default agent, Antigravity, in its own skill syntax", async () => {
    const { server, tab, wsId } = await setUp(['planning'], { defaultAgent: 'antigravity' });
    const started = await request(server, tab, 'POST', apiPath(API_ROUTES.workspacePlanningSessions, { wsId }), { skill: 'bmad-spec', idea: 'a habit tracker' });
    expect(started.status).toBe(201);
    const { session } = SessionResponse.parse(await started.json());
    expect(session).toMatchObject({ kind: 'planning', agentId: 'antigravity' });
    expect(messagesOf(server, session.id, 'user')).toEqual(['/bmad-spec a habit tracker']);
    await waitFor(() => server.core.entities.getSession(session.id)!.state === 'idle' && messagesOf(server, session.id, 'agent').length > 0, "Antigravity's reply", 15_000);
  });

  it('Set up places the skills in .agents/skills too while Antigravity is in use, by default or by a chat', async () => {
    const byDefault = await setUp(['planning'], { defaultAgent: 'antigravity' });
    expect(await setUpBmad(byDefault.server, byDefault.tab, byDefault.wsId, byDefault.bmadCatalog)).toEqual({ skillFolders: ['.agents/skills'] });

    const byChat = await setUp(['planning']);
    const chat = await request(byChat.server, byChat.tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: byChat.wsId }), { agentId: 'antigravity' });
    expect(chat.status).toBe(201);
    expect(await setUpBmad(byChat.server, byChat.tab, byChat.wsId, byChat.bmadCatalog)).toEqual({ skillFolders: ['.agents/skills'] });
  });

  it('Set up keeps to .claude/skills with Claude Code alone, or with only Board on', async () => {
    const claudeOnly = await setUp(['planning']);
    expect(await setUpBmad(claudeOnly.server, claudeOnly.tab, claudeOnly.wsId, claudeOnly.bmadCatalog)).toEqual({});

    const boardOnly = await setUp(['board'], { defaultAgent: 'antigravity' });
    expect(await setUpBmad(boardOnly.server, boardOnly.tab, boardOnly.wsId, boardOnly.bmadCatalog)).toEqual({});
  });
});
