/**
 * A simple project stays a plain multi-chat workspace (E10-R3, R2, R8;
 * AD-22; story 10.6): with every BMad piece off, its sessions start with
 * nothing BMad from Ogden (no MCP server, no `_meta`, no added prompt text,
 * no BMad environment), and Ogden writes nothing under the repo, which keeps
 * its own `.claude/skills` untouched. Claude Code itself still loads the
 * repo's own skills, `CLAUDE.md` and settings, exactly as in a terminal
 * (claude-agent-acp's `settingSources`); that is the repo's, not Ogden's.
 *
 * A real server, the real `acp-claude-code` adapter and the fake ACP agent
 * (`session-start` reports what its session started with).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_ROUTES,
  apiPath,
  SessionResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type SessionId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { AGENT_ENV_KEYS } from '../src/start-env.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

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
    '__CF_USER_TEXT_ENCODING',
    // libuv adds these on Windows to every child it spawns (its required variables), whatever env it is given.
    'HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'WINDIR',
  ].map((name) => name.toUpperCase()),
);
const allowedAgentEnvName = (name: string) => ALLOWED_AGENT_ENV.has(name.toUpperCase()) || name === 'LC_ALL' || name.startsWith('LC_');

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
  { name: 'a plain repo with its own .claude/skills', bmad: false },
  { name: 'a repo that already has _bmad/ (pieces off)', bmad: true },
])('a simple project: $name (story 10.6)', ({ bmad }) => {
  it("starts its sessions with nothing BMad from Ogden and writes nothing under the repo", async () => {
    // No "bmad" in the folder's name, so nothing below matches it by accident.
    const repo = createFakeBmadRepo({ bmad, files: { [OWN_SKILL]: OWN_SKILL_TEXT }, prefix: 'ogden-agents-simple-repo-' });
    // Removed by helpers' afterEach, once the server (and its agents) are closed.
    removeAfterTest(repo.path);
    const before = repo.hash();

    const server = await startTestServer();
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
      const opened = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {});
      expect(opened.status).toBe(201);
      const { session } = SessionResponse.parse(await opened.json());
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
      expect(Object.keys(start.env).length).toBeGreaterThan(0);
      // Only names Ogden's agent environment allows: nothing pointing Claude Code at other skills or config.
      expect(Object.keys(start.env).filter((name) => !allowedAgentEnvName(name))).toEqual([]);
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
