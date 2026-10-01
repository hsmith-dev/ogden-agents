/**
 * The toggle's availability check (story 3.7): core's switch refusal, in its
 * order, as `GET` session's `terminal`. Fakes for every row of the plan's
 * matrix, then through a real server (the fake ACP agent, the fake CLI as
 * `CLAUDE_CODE_EXECUTABLE`). No test runs the real `claude`.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPty } from '@ogden-agents/adapters';
import { AGENT_SESSION_REF, type AgentTerminalResume, type TerminalPort } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, apiPath, SessionResponse, WorkspaceResponse, type Session, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it, vi } from 'vitest';
import { createTerminalAvailability, PTY_LOAD_FAILED } from '../src/terminal-availability.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_CLI = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-claude-cli.mjs');

const reached = { adapterRefs: { [AGENT_SESSION_REF]: 'agent-session-1' } } as unknown as Session;
const fresh = { adapterRefs: {} } as unknown as Session;

function resume(location: Awaited<ReturnType<AgentTerminalResume['locate']>> = { found: true }) {
  return {
    locate: vi.fn(async (_env: Readonly<Record<string, string>>) => location),
    command: vi.fn(async () => {
      throw new Error('the check never builds a command');
    }),
  };
}

function port(availability: Awaited<ReturnType<TerminalPort['available']>> = { ok: true }) {
  return {
    available: vi.fn(async () => availability),
    open: vi.fn(async () => {
      throw new Error('the check never opens a terminal');
    }),
  };
}

describe('the availability check, row by row', () => {
  it('Supported: the capability, an agent session, node-pty and the CLI', async () => {
    const terminalResume = resume();
    const terminal = port();
    const env = { CLAUDE_CODE_EXECUTABLE: 'claude', HOME: 'home' };
    const check = createTerminalAvailability({ agent: { displayName: 'Claude Code', terminalResume }, terminal, env: () => env });
    expect(await check(reached)).toEqual({ available: true });
    expect(terminalResume.locate).toHaveBeenCalledWith(env);
    expect(terminalResume.command).not.toHaveBeenCalled();
    expect(terminal.open).not.toHaveBeenCalled();
  });

  it('No capability: agent_unsupported, before anything else', async () => {
    const terminal = port({ ok: false, reason: 'broken' });
    const check = createTerminalAvailability({ agent: { displayName: 'Gemini CLI' }, terminal });
    expect(await check(fresh)).toEqual({ available: false, code: 'agent_unsupported', reason: "Gemini CLI can't pick up this session in its terminal." });
    expect(terminal.available).not.toHaveBeenCalled();
  });

  it('No terminal port: pty_unavailable, before the agent session', async () => {
    const check = createTerminalAvailability({ agent: { displayName: 'Claude Code', terminalResume: resume() } });
    expect(await check(fresh)).toEqual({ available: false, code: 'pty_unavailable', reason: "The terminal couldn't start on this computer." });
  });

  it('Never reached the agent: no_agent_session, before node-pty is loaded', async () => {
    const terminal = port({ ok: false, reason: 'broken' });
    const check = createTerminalAvailability({ agent: { displayName: 'Claude Code', terminalResume: resume() }, terminal });
    const expected = { available: false, code: 'no_agent_session', reason: 'Send Claude Code a message first, then switch to the terminal.' };
    expect(await check(fresh)).toEqual(expected);
    expect(await check({ adapterRefs: { [AGENT_SESSION_REF]: '' } } as unknown as Session)).toEqual(expected);
    expect(terminal.available).not.toHaveBeenCalled();
  });

  it('node-pty failed: pty_unavailable with its plain reason, and the CLI is not looked for', async () => {
    const terminalResume = resume({ found: false, reason: 'no CLI' });
    const check = createTerminalAvailability({
      agent: { displayName: 'Claude Code', terminalResume },
      terminal: port({ ok: false, reason: 'node-pty failed to load' }),
    });
    expect(await check(reached)).toEqual({
      available: false,
      code: 'pty_unavailable',
      reason: "The terminal couldn't start on this computer: node-pty failed to load",
    });
    expect(terminalResume.locate).not.toHaveBeenCalled();
  });

  it('CLI missing: cli_not_found with locate’s reason', async () => {
    const check = createTerminalAvailability({
      agent: { displayName: 'Claude Code', terminalResume: resume({ found: false, reason: "Claude Code's terminal couldn't be found on this computer." }) },
      terminal: port(),
    });
    expect(await check(reached)).toEqual({ available: false, code: 'cli_not_found', reason: "Claude Code's terminal couldn't be found on this computer." });
  });

  it('a reason that names a path, a stack or a home folder is never shown', async () => {
    const secrets = [
      "Cannot find module '/Users/someone/node_modules/node-pty/build/Release/pty.node'",
      'C:\\Users\\someone\\AppData\\claude.exe is missing',
      'not found in ~ either',
      'first line\n    at load (internal.js:1:1)',
    ];
    for (const secret of secrets) {
      const pty = await createTerminalAvailability({
        agent: { displayName: 'Claude Code', terminalResume: resume() },
        terminal: port({ ok: false, reason: secret }),
      })(reached);
      expect(pty).toEqual({ available: false, code: 'pty_unavailable', reason: `The terminal couldn't start on this computer: ${PTY_LOAD_FAILED}` });
      const cli = await createTerminalAvailability({
        agent: { displayName: 'Claude Code', terminalResume: resume({ found: false, reason: secret }) },
        terminal: port(),
      })(reached);
      expect(cli).toEqual({ available: false, code: 'cli_not_found', reason: "Claude Code's terminal couldn't be found on this computer." });
    }
  });

  it('a check that throws rejects, for the route’s own fallback', async () => {
    const terminal = { available: async () => Promise.reject(new Error('boom')), open: async () => Promise.reject(new Error('no')) };
    const check = createTerminalAvailability({ agent: { displayName: 'Claude Code', terminalResume: resume() }, terminal });
    await expect(check(reached)).rejects.toThrow('boom');
  });
});

/** A temp folder, removed after the test once its server is closed. */
const tempDir = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

async function startServer(options: Parameters<typeof startTestServer>[0] = {}) {
  const server = await startTestServer({
    extraAgentEnv: {
      CLAUDE_CODE_EXECUTABLE: FAKE_CLI,
      FAKE_CLAUDE_RECORD: join(tempDir('ogden-agents-cli-'), 'record.json'),
      FAKE_ACP_RESUME: 'resume',
      CLAUDE_CONFIG_DIR: tempDir('ogden-agents-claude-'),
    },
    ...options,
  });
  return { server, tab: await signIn(server) };
}

const post = (server: TestServer, tab: SignedIn, path: string, body: unknown) =>
  fetch(`${server.url}${path}`, { method: 'POST', headers: { ...tab.headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const agentReplies = (server: TestServer, sessionId: SessionId) =>
  server.core.events.readAfter(0).filter((e) => e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === 'agent').length;

/** A chat that has answered one message, and its `GET` session. */
async function answeredChat(server: TestServer, tab: SignedIn) {
  const { workspace } = WorkspaceResponse.parse(await (await post(server, tab, API_ROUTES.workspaces, { path: tempDir('ogden-agents-repo-') })).json());
  const { session } = SessionResponse.parse(await (await post(server, tab, apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
  const ids = { wsId: workspace.id, sesId: session.id };
  expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'first question' })).status).toBe(202);
  await waitFor(() => server.core.entities.getSession(session.id)!.state === 'idle' && agentReplies(server, session.id) === 1, 'the first reply', 15_000);
  const get = async () => {
    const response = await fetch(`${server.url}${apiPath(API_ROUTES.workspaceSession, ids)}`, { headers: tab.headers });
    expect(response.status).toBe(200);
    return SessionResponse.parse(await response.json());
  };
  return { ids, sessionId: session.id, get };
}

const realPty = await loadPty();
describe('through a real server', () => {
  it('node-pty failing to load: GET session says so in plain words, and chat still works (AD-19)', async () => {
    const { server, tab } = await startServer({
      loadPty: async () => ({ ok: false, reason: 'no prebuilt terminal for this platform', detail: 'Error: injected at /secret/path' }),
    });
    const { ids, sessionId, get } = await answeredChat(server, tab);
    const { terminal } = await get();
    expect(terminal).toEqual({
      available: false,
      code: 'pty_unavailable',
      reason: "The terminal couldn't start on this computer: no prebuilt terminal for this platform",
    });
    expect(JSON.stringify(terminal)).not.toContain('/secret/path');
    // The chat goes on.
    expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'second question' })).status).toBe(202);
    await waitFor(() => agentReplies(server, sessionId) === 2, 'the second reply', 15_000);
  }, 30_000);

  it.runIf(realPty.ok || process.env.CI !== undefined)('available on GET means core switches at once, and back', async () => {
    const { server, tab } = await startServer();
    const { ids, get } = await answeredChat(server, tab);
    expect((await get()).terminal).toEqual({ available: true });
    const switched = await post(server, tab, apiPath(API_ROUTES.sessionDriver, ids), { driver: 'terminal' });
    if (switched.status !== 200) throw new Error(`refused: ${JSON.stringify(ApiErrorBody.parse(await switched.json()).error)}`);
    expect(SessionResponse.parse(await switched.json()).session.driver).toBe('terminal');
    const back = await post(server, tab, apiPath(API_ROUTES.sessionDriver, ids), { driver: 'ui' });
    expect(back.status).toBe(200);
  }, 30_000);
});
