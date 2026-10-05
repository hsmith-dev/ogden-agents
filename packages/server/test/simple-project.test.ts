/**
 * A simple project stays a plain multi-chat workspace (E10-R3, R2, R8;
 * AD-22; story 10.6): with every BMad piece off, its sessions start with
 * nothing BMad from Ogden (no MCP server, no `_meta`, no added prompt text,
 * no BMad environment), and Ogden writes nothing under the repo, which keeps
 * its own `.claude/skills` untouched. Claude Code itself still loads the
 * repo's own skills, `CLAUDE.md` and settings, exactly as in a terminal
 * (claude-agent-acp's `settingSources`); that is the repo's, not Ogden's.
 *
 * The same holds for the second agent (epic 6 entry 8, epic 10 retro A8):
 * Antigravity, its server played by the fake agent's Antigravity personality
 * through the installed suite's test hook (`OGDEN_AGENTS_TEST_ANTIGRAVITY_SERVER`),
 * gets no BMad skill or text from Ogden either, and writes nothing.
 *
 * A real server, the real `acp-claude-code` and `acp-antigravity` adapters
 * and the fake ACP agent (`session-start` reports what its session started
 * with). No test runs the real Antigravity server, reads `~/.gemini` or
 * reaches Google.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANTIGRAVITY_PINS, writeInstallRecord } from '@ogden-agents/adapters';
import {
  API_ROUTES,
  apiPath,
  SessionResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type SessionId,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { AGENT_ENV_KEYS } from '../src/start-env.js';
import { ANTIGRAVITY_SERVER_ENV } from '../src/test-hooks.js';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_ANTIGRAVITY = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-antigravity.mjs');
const GEMINI_KEY = `AIza${'S'.repeat(31)}5678`;
const PINNED = ANTIGRAVITY_PINS.archives[`${process.platform}-${process.arch}` as keyof typeof ANTIGRAVITY_PINS.archives];

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * A server whose agent for new chats is `agent`. For Antigravity: a data
 * folder with its pinned server planted (an empty file, never run), the
 * hook's script in the temp folder starting the fake's Antigravity
 * personality instead, and a Gemini key in the server's environment.
 */
async function serverFor(agent: 'claude-code' | 'antigravity'): Promise<TestServer> {
  if (agent === 'claude-code') return startTestServer();
  const dataDir = tempDataDir();
  const folder = join(dataDir, 'agents', 'antigravity', ANTIGRAVITY_PINS.version);
  mkdirSync(folder, { recursive: true });
  // The pinned files (empty, never run) and the install record Install writes once it checked them (6.7).
  for (const name of Object.keys(PINNED!.files)) writeFileSync(join(folder, name), '');
  writeInstallRecord(folder, { version: ANTIGRAVITY_PINS.version, platform: `${process.platform}-${process.arch}`, reportedVersion: ANTIGRAVITY_PINS.version, files: Object.fromEntries(Object.keys(PINNED!.files).map((name) => [name, 0])) });
  const script = join(tempDataDir(), 'antigravity-server.mjs');
  writeFileSync(script, `await import(${JSON.stringify(pathToFileURL(FAKE_ANTIGRAVITY).href)});\n`);
  vi.stubEnv(ANTIGRAVITY_SERVER_ENV, script);
  // Antigravity wired as shipped (not left out as the other tests do), so the hook decides its server.
  return startTestServer({ dataDir, antigravity: undefined, extraAgentEnv: { GEMINI_API_KEY: GEMINI_KEY } });
}

const OWN_SKILL = '.claude/skills/x/SKILL.md';
const OWN_SKILL_TEXT = '---\nname: x\ndescription: The repo\'s own skill.\n---\n\nDo the thing.\n';

/**
 * Every name a chat's agent may get: the server's allowlist (`agentEnvironment`
 * in start-env.ts: user, home, locale, terminal, temp, shell; three more on
 * Windows), the agent keys (`AGENT_ENV_KEYS`), `CLAUDE_CODE_EXECUTABLE`
 * (set by the adapter or the test CLI hook), and what the OS adds to a new
 * process by itself (macOS's `__CF_USER_TEXT_ENCODING`). Compared without case.
 */
const ALLOWED_AGENT_ENV = new Set(
  [
    'PATH', 'HOME', 'USERPROFILE', 'USER', 'USERNAME', 'LANG', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'SHELL',
    'SystemRoot', 'ComSpec', 'PATHEXT',
    ...AGENT_ENV_KEYS,
    'CLAUDE_CODE_EXECUTABLE',
    // Antigravity's own home in the data folder (its descriptor's `homeEnv`, 6.3).
    'GEMINI_HOME',
    // The fake login's state file every test server gives the fake agent (6.3: Claude Code signed in).
    'FAKE_LOGIN_STATE',
    '__CF_USER_TEXT_ENCODING',
    // libuv adds these on Windows to every child it spawns (its required variables), whatever env it is given.
    'HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'WINDIR',
  ].map((name) => name.toUpperCase()),
);
const allowedAgentEnvName = (name: string) => ALLOWED_AGENT_ENV.has(name.toUpperCase()) || name === 'LC_ALL' || name.startsWith('LC_');
/** The switches `fake-antigravity.mjs` sets in its own process before it starts the fake agent: the fake's, not Ogden's. */
const FAKE_ANTIGRAVITY_SWITCHES = new Set([
  'FAKE_ACP_PERSONALITY', 'FAKE_ACP_MODES', 'FAKE_ACP_AUTH_METHODS', 'FAKE_ACP_API_KEY_ENV',
  'FAKE_ACP_HOME_ENV', 'FAKE_ACP_RESUME', 'FAKE_ACP_REQUIRE_AUTH', 'FAKE_ACP_AGENT_NAME',
]);
const fakeOwnEnvName = (name: string) => FAKE_ANTIGRAVITY_SWITCHES.has(name);

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** What the fake agent's `session-start` reports. */
interface SessionStart {
  via: string;
  cwd: string;
  mcpServers: unknown;
  meta: unknown;
  prompt: string;
  env: Record<string, string>;
}

const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;

/** The agent's replies in `sessionId`, in order. */
const repliesOf = (server: TestServer, sessionId: SessionId) =>
  server.core.events
    .readAfter(0)
    .flatMap((e) => (e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));

describe.each([
  { name: 'a plain repo with its own .claude/skills, Claude Code', bmad: false, agent: 'claude-code' as const },
  { name: 'a repo that already has _bmad/ (pieces off), Claude Code', bmad: true, agent: 'claude-code' as const },
  { name: 'a plain repo with its own .claude/skills, Antigravity (entry 8)', bmad: false, agent: 'antigravity' as const },
  { name: 'a repo that already has _bmad/ (pieces off), Antigravity (entry 8)', bmad: true, agent: 'antigravity' as const },
])('a simple project: $name (story 10.6)', ({ bmad, agent }) => {
  // Antigravity runs only where it has a pin for this platform.
  it.skipIf(agent === 'antigravity' && PINNED === undefined)("starts its sessions with nothing BMad from Ogden and writes nothing under the repo", async () => {
    // No "bmad" in the folder's name, so nothing below matches it by accident.
    const repo = createFakeBmadRepo({ bmad, files: { [OWN_SKILL]: OWN_SKILL_TEXT }, prefix: 'ogden-agents-simple-repo-' });
    // Removed by helpers' afterEach, once the server (and its agents) are closed.
    removeAfterTest(repo.path);
    const before = repo.hash();

    const server = await serverFor(agent);
    const tab = await signIn(server);

    const added = await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path });
    expect(added.status).toBe(201);
    const { workspace } = WorkspaceResponse.parse(await added.json());
    const settingsPath = apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id });
    const settings = WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', settingsPath)).json()).settings;
    expect(settings.bmadPieces).toEqual([]);

    // Two chats, each with its first message.
    const starts: SessionStart[] = [];
    for (let i = 0; i < 2; i++) {
      const opened = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), { agentId: agent });
      expect(opened.status).toBe(201);
      const { session } = SessionResponse.parse(await opened.json());
      expect(session.agentId).toBe(agent);
      const sent = await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: session.id }), { text: 'session-start' });
      expect(sent.status).toBe(202);
      await waitFor(() => stateOf(server, session.id) === 'idle' && repliesOf(server, session.id).length > 0, 'the first reply', 15_000);
      starts.push(JSON.parse(repliesOf(server, session.id).join('')) as SessionStart);
    }

    for (const start of starts) {
      expect(start.via).toBe('new');
      expect(start.cwd).toBe(workspace.realPath ?? workspace.path);
      expect(start.mcpServers).toEqual([]);
      expect(start.meta).toBeNull();
      // Exactly the user's text: no skill, system prompt or instructions added.
      expect(start.prompt).toBe('session-start');
      // The agent asked for answered: Antigravity's personality, in its own home (the hook's script, not the planted pin).
      if (agent === 'antigravity') expect({ personality: start.env.FAKE_ACP_PERSONALITY, home: typeof start.env.GEMINI_HOME }).toEqual({ personality: 'antigravity', home: 'string' });
      expect(Object.keys(start.env).length).toBeGreaterThan(0);
      // Only names Ogden's agent environment allows: nothing pointing Claude Code at other skills or config.
      expect(Object.keys(start.env).filter((name) => !allowedAgentEnvName(name) && !(agent === 'antigravity' && fakeOwnEnvName(name)))).toEqual([]);
      // No BMad in a value Ogden set; one inherited unchanged from this process (a PATH, a home) is the user's own.
      const set = Object.entries(start.env).filter(([name, value]) => process.env[name] !== value);
      expect(set.filter(([name, value]) => /bmad/i.test(name) || /bmad/i.test(value))).toEqual([]);
    }

    // A settings change (caution level) touches the repo no more than adding it and chatting did.
    const patched = await request(server, tab, 'PATCH', settingsPath, { cautionLevel: 'ask_for_commands' });
    expect(patched.status).toBe(200);
    expect(WorkspaceSettingsResponse.parse(await patched.json()).settings.bmadPieces).toEqual([]);

    await server.close();
    expect(repo.hash()).toBe(before);
    expect(readFileSync(join(repo.path, ...OWN_SKILL.split('/')), 'utf8')).toBe(OWN_SKILL_TEXT);
    expect(existsSync(join(repo.path, '_bmad'))).toBe(bmad);
    expect(existsSync(join(repo.path, '_bmad-output'))).toBe(false);
  });
});
