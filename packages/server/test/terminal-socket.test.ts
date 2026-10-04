/**
 * A chat switched to its agent's own terminal and back (story 3.1), end to
 * end: a real server, the fake ACP agent as the chat's agent, and the fake
 * CLI (`tests/fixtures/fake-claude-cli.mjs`, as `CLAUDE_CODE_EXECUTABLE`) in
 * the real `node-pty`, over `/ws/terminal/:sesId`. No test runs the real
 * `claude`. The gate's refusals of the terminal socket are in gate.test.ts.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import { createMemoryTerminalPort, loadPty, projectSlug, stripTerminalEscapes } from '@ogden-agents/adapters';
import { AGENT_SESSION_REF, createChat, openCore, type AgentEvent, type AgentPort, type AgentSession } from '@ogden-agents/core';
import { Hono } from 'hono';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  MAX_TERMINAL_INPUT_BYTES,
  SessionResponse,
  SessionTerminal,
  TERMINAL_CLOSE,
  WorkspaceResponse,
  type CoreEvent,
  type SessionId,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { MAX_WS_PAYLOAD_BYTES, type StartOptions } from '../src/start.js';
import { registerChatRoutes, TERMINAL_CHECK_FAILED } from '../src/chat-routes.js';
import { createLogger, LOG_DIR } from '../src/log.js';
import {
  ATTACH_WAIT_MS,
  CONTROL_FRAME_COST_BYTES,
  createInputBudget,
  INPUT_BURST_BYTES,
  INPUT_BYTES_PER_SECOND,
  MAX_TERMINAL_VIEWERS,
  registerTerminalSocket,
  TERMINAL_TOO_MANY_VIEWERS,
} from '../src/terminal-socket.js';
import { signIn, startTestServer, tempDataDir, trackSocket, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures');
const FAKE_CLI = join(FIXTURES, 'fake-claude-cli.mjs');
const MARKER = 'terminal-marker-5b1e0d';

const dirs: string[] = [];
const servers: TestServer[] = [];
/** The in-memory socket servers' own stops. */
const stops: Array<() => Promise<void>> = [];
// Servers first (closing one stops its agents and terminals), then the folders they ran in.
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(stops.splice(0).map((stop) => stop()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

interface CliRecord {
  argv: string[];
  cwd: string;
  pid: number;
  grandchild: number | null;
  term: string;
  envNames: string[];
}

/**
 * A server whose chat agent is the fake ACP agent (resuming sessions) and
 * whose terminal runs the fake CLI, recording to `record`. Never the real
 * `claude`, and never the user's own `~/.claude`: Claude Code's config folder
 * (where the fake CLI records its sessions, story 3.3) is a temp one.
 */
async function startTerminalServer(options: StartOptions & { lines?: string[] } = {}) {
  const record = join(tempDir('ogden-agents-cli-'), 'record.json');
  const claudeConfig = tempDir('ogden-agents-claude-');
  const server = await startTestServer({
    ...options,
    extraAgentEnv: { CLAUDE_CODE_EXECUTABLE: FAKE_CLI, FAKE_CLAUDE_RECORD: record, FAKE_ACP_RESUME: 'resume', CLAUDE_CONFIG_DIR: claudeConfig, ...options.extraAgentEnv },
  });
  servers.push(server);
  return { server, claudeConfig, tab: await signIn(server), record: () => JSON.parse(readFileSync(record, 'utf8')) as CliRecord, recorded: () => existsSync(record) };
}

/** The fake CLI's switches for a test: it starts a child of its own (story 3.4), plus `extra`. */
const grandchildEnv = (extra: Record<string, string> = {}) => ({ FAKE_CLAUDE_GRANDCHILD: '1', ...extra });

function post(server: TestServer, tab: SignedIn, path: string, body: unknown) {
  return fetch(`${server.url}${path}`, { method: 'POST', headers: { ...tab.headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;

/** A chat in a fresh project folder that has answered one message. */
async function answeredChat(server: TestServer, tab: SignedIn) {
  const repo = tempDir('ogden-agents-repo-');
  const { workspace } = WorkspaceResponse.parse(await (await post(server, tab, API_ROUTES.workspaces, { path: repo })).json());
  const { session } = SessionResponse.parse(await (await post(server, tab, apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
  const ids = { wsId: workspace.id, sesId: session.id };
  expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'first question' })).status).toBe(202);
  await waitFor(() => stateOf(server, session.id) === 'idle' && replies(server, session.id).length === 1, 'the first reply', 15_000);
  return { repo, ids, sessionId: session.id };
}

const replies = (server: TestServer, sessionId: SessionId) =>
  server.core.events.readAfter(0).filter((e) => e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === 'agent');

const driverChanges = (server: TestServer, sessionId: SessionId) =>
  server.core.events.readAfter(0).flatMap((e) => (e.streamId === sessionId && e.type === 'session.driver_changed' ? [e.payload.driver] : []));

const driverCauses = (server: TestServer, sessionId: SessionId) =>
  server.core.events.readAfter(0).flatMap((e) => (e.streamId === sessionId && e.type === 'session.driver_changed' ? [e.payload.cause] : []));

const getSession = async (server: TestServer, tab: SignedIn, ids: { wsId: string; sesId: string }) => {
  const response = await fetch(`${server.url}${apiPath(API_ROUTES.workspaceSession, ids)}`, { headers: tab.headers });
  expect(response.status).toBe(200);
  return SessionResponse.parse(await response.json());
};

const switchTo = (server: TestServer, tab: SignedIn, ids: { wsId: string; sesId: string }, driver: 'ui' | 'terminal') =>
  post(server, tab, apiPath(API_ROUTES.sessionDriver, ids), { driver });

/**
 * A terminal viewer: the text of every binary frame, the control frames, and
 * how it closed. Like the web client, its first frame is `attach` with
 * `attach`'s size (story 3.5), unless `attach` is `false`.
 */
function openTerminal(server: TestServer, tab: SignedIn, sessionId: string, attach: { cols: number; rows: number } | false = { cols: 80, rows: 24 }) {
  return viewerOn(`ws://127.0.0.1:${server.port}/ws/terminal/${sessionId}`, tab, attach);
}

function viewerOn(url: string, tab: Pick<SignedIn, 'protocols' | 'origin'> | undefined, attach: { cols: number; rows: number } | false) {
  const ws = trackSocket(new WebSocket(url, tab?.protocols ?? [], tab === undefined ? {} : { headers: { origin: tab.origin } }));
  const state = {
    raw: '',
    /** What the screen shows: ConPTY (Windows) repaints with escape sequences between the CLI's tokens. */
    get output() {
      return stripTerminalEscapes(this.raw);
    },
    frames: [] as unknown[],
    closed: undefined as number | undefined,
    protocol: '',
  };
  const decoder = new TextDecoder();
  ws.on('message', (data, isBinary) => {
    if (isBinary) state.raw += decoder.decode(data as Buffer, { stream: true });
    else state.frames.push(JSON.parse(String(data)));
  });
  ws.on('close', (code) => (state.closed = code));
  ws.on('error', () => {});
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      state.protocol = ws.protocol;
      if (attach !== false) ws.send(JSON.stringify({ type: 'attach', ...attach }));
      resolve();
    });
    ws.once('unexpected-response', (_req, res) => reject(new Error(`upgrade refused: ${res.statusCode}`)));
  });
  return {
    ws,
    state,
    opened,
    type: (text: string) => ws.send(Buffer.from(text, 'utf8'), { binary: true }),
    control: (frame: unknown) => ws.send(JSON.stringify(frame)),
  };
}

/** The session's events after `seq`: completed messages as `[role, content, origin]`, others by type. */
const appendedSince = (server: TestServer, sessionId: SessionId, seq: number) =>
  server.core.events
    .readAfter(seq)
    .filter((e) => e.streamId === sessionId)
    .map((e) => (e.type === 'session.message_completed' ? [e.payload.role, e.payload.content, e.payload.origin] : [e.type]));

/** Every completed message of the session as `[role, content, origin]`. */
const completed = (server: TestServer, sessionId: SessionId) =>
  appendedSince(server, sessionId, 0).filter((entry) => entry.length === 3);

/** What a freshly loaded page receives for the workspace on `/ws` until it is caught up. */
async function historyOf(server: TestServer, tab: SignedIn, workspaceId: string): Promise<CoreEvent[]> {
  const ws = trackSocket(new WebSocket(`ws://127.0.0.1:${server.port}/ws`, tab.protocols, { headers: { origin: tab.origin } }));
  ws.on('error', () => {});
  const received: CoreEvent[] = [];
  const caughtUp = new Promise<void>((resolve) =>
    ws.on('message', (data) => {
      const message = JSON.parse(String(data)) as { type: string };
      if (message.type === 'caught_up') resolve();
      else if ('seq' in message) received.push(message as unknown as CoreEvent);
    }),
  );
  await new Promise<void>((resolve) => ws.once('open', () => resolve()));
  ws.send(JSON.stringify({ type: 'subscribe_workspace', workspaceId }));
  await caughtUp;
  ws.close();
  return received;
}

/** Whether a process with this pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Every file under `dir`, for the marker search (the database, its WAL, the logs). */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('switching when node-pty cannot load (AD-19)', () => {
  it('refuses with a plain reason, 409, and leaves the chat driving', async () => {
    const { server, tab, recorded } = await startTerminalServer({
      loadPty: async () => ({ ok: false, reason: 'no prebuilt terminal for this platform', detail: 'Error: injected' }),
    });
    const { ids, sessionId } = await answeredChat(server, tab);
    const refused = await switchTo(server, tab, ids, 'terminal');
    expect(refused.status).toBe(409);
    const { error } = ApiErrorBody.parse(await refused.json());
    expect(error).toMatchObject({ code: 'terminal_unavailable', details: { terminal: { available: false, code: 'pty_unavailable' } } });
    expect(error.message).toContain('no prebuilt terminal for this platform');
    expect(SessionTerminal.parse(error.details!.terminal)).toEqual({ available: false, code: 'pty_unavailable', reason: error.message });
    expect(server.core.entities.getSession(sessionId)!.driver).toBe('ui');
    expect(driverChanges(server, sessionId)).toEqual([]);
    expect(recorded()).toBe(false);
  }, 30_000);

  it('refuses a chat that never reached its agent, and a malformed driver', async () => {
    const { server, tab } = await startTerminalServer();
    const repo = tempDir('ogden-agents-repo-');
    const { workspace } = WorkspaceResponse.parse(await (await post(server, tab, API_ROUTES.workspaces, { path: repo })).json());
    const { session } = SessionResponse.parse(await (await post(server, tab, apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
    const ids = { wsId: workspace.id, sesId: session.id };
    const refused = await switchTo(server, tab, ids, 'terminal');
    expect(refused.status).toBe(409);
    const message = 'Send Claude Code a message first, then switch to the terminal.';
    expect(ApiErrorBody.parse(await refused.json()).error).toEqual({
      code: 'terminal_unavailable',
      message,
      details: { terminal: { available: false, code: 'no_agent_session', reason: message } },
    });
    expect((await post(server, tab, apiPath(API_ROUTES.sessionDriver, ids), { driver: 'shell' })).status).toBe(400);
  }, 30_000);
});

describe('the terminal contract on the API (story 3.2)', () => {
  it('GET session says whether the terminal can work; only that answer carries it', async () => {
    const { server, tab } = await startTerminalServer();
    const repo = tempDir('ogden-agents-repo-');
    const { workspace } = WorkspaceResponse.parse(await (await post(server, tab, API_ROUTES.workspaces, { path: repo })).json());
    const created = await post(server, tab, apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {});
    const body = SessionResponse.parse(await created.json());
    expect(body.terminal).toBeUndefined();
    // A chat that never reached its agent has nothing to resume (story 3.7; the other checks are in terminal-availability.test.ts).
    expect((await getSession(server, tab, { wsId: workspace.id, sesId: body.session.id })).terminal).toEqual({
      available: false,
      code: 'no_agent_session',
      reason: 'Send Claude Code a message first, then switch to the terminal.',
    });
  }, 30_000);

  it('a throwing availability check still answers GET session: pty_unavailable in plain words, and only a code is logged', async () => {
    const core = openCore(tempDataDir());
    try {
      const chat = createChat({
        dataDir: tempDataDir(),
        entities: core.entities,
        sessionEvents: core.sessionEvents,
        agent: {
          displayName: 'Test Agent',
          skillInvocation: (skill) => `/${skill}`,
          startSession: () => Promise.reject(new Error('no agent in this test')),
          reopenSession: () => Promise.reject(new Error('no agent in this test')),
          listAuthMethods: () => Promise.reject(new Error('no agent in this test')),
        },
      });
      const lines: string[] = [];
      const app = new Hono();
      const secretPath = '/Users/someone/private/node-pty.node';
      registerChatRoutes(app, chat, createLogger((line) => void lines.push(line)), {
        terminalAvailability: async () => {
          throw Object.assign(new Error(`cannot open ${secretPath}`), { code: 'ENOENT' });
        },
      });
      const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
      const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
      const response = await app.request(apiPath(API_ROUTES.workspaceSession, { wsId: workspace.id, sesId: session.id }));
      expect(response.status).toBe(200);
      const body = SessionResponse.parse(await response.json());
      expect(body.session.id).toBe(session.id);
      expect(body.terminal).toEqual({ available: false, code: 'pty_unavailable', reason: TERMINAL_CHECK_FAILED });
      expect(lines.join('')).toContain('"code":"ENOENT"');
      expect(lines.join('')).not.toContain(secretPath);
      expect(JSON.stringify(body)).not.toContain(secretPath);
      await chat.close();
    } finally {
      core.close();
    }
  });

  it('a switch while the agent works is 409 session_not_idle, and nothing is interrupted', async () => {
    const { server, tab, recorded } = await startTerminalServer();
    const { ids, sessionId } = await answeredChat(server, tab);
    expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'hold' })).status).toBe(202);
    await waitFor(() => stateOf(server, sessionId) === 'working', 'the agent to work', 15_000);
    const refused = await switchTo(server, tab, ids, 'terminal');
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toEqual({ code: 'session_not_idle', message: 'Claude Code is busy. Switch to the terminal when it is idle.' });
    expect(stateOf(server, sessionId)).toBe('working');
    expect(server.core.entities.getSession(sessionId)!.driver).toBe('ui');
    expect(recorded()).toBe(false);
    expect((await post(server, tab, apiPath(API_ROUTES.sessionCancel, ids), {})).status).toBe(204);
    await waitFor(() => stateOf(server, sessionId) === 'idle', 'the stop', 15_000);
  }, 30_000);
});

describe('a server start after a stop that left a chat in the terminal (review F3)', () => {
  it('gives every such chat back to the chat, with session.driver_changed', async () => {
    const dataDir = tempDataDir();
    const core = openCore(dataDir);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const other = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    core.entities.setSessionDriver(session.id, 'terminal');
    core.close();

    const { server } = await startTerminalServer({ dataDir });
    expect(server.core.entities.getSession(session.id)!.driver).toBe('ui');
    expect(driverChanges(server, session.id)).toEqual(['terminal', 'ui']);
    expect(driverCauses(server, session.id)).toEqual([undefined, 'server_restarted']);
    expect(driverChanges(server, other.id)).toEqual([]);
  }, 30_000);
});

describe('frame sizes on every socket (review F1)', () => {
  it('closes a socket sent a frame over the server-wide limit (1009) before buffering it; /ws takes its ordinary messages', async () => {
    const { server, tab } = await startTerminalServer();
    const ws = trackSocket(new WebSocket(`ws://127.0.0.1:${server.port}/ws`, tab.protocols, { headers: { origin: tab.origin } }));
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('error', () => {});
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(JSON.stringify({ type: 'ping' }));
    await new Promise<void>((resolve) => ws.once('message', () => resolve()));
    ws.send(Buffer.alloc(MAX_WS_PAYLOAD_BYTES + 1, 0x61), { binary: true });
    expect(await closed).toBe(1009);
  }, 30_000);
});

// The real node-pty. Required on CI; skipped locally only if node-pty can't load.
const realPty = await loadPty();
describe.runIf(realPty.ok || process.env.CI !== undefined)('a chat switched to its terminal and back (fake CLI in the real terminal)', () => {
  it('opens the CLI on the same session in the project folder, carries bytes, and back; the next message gets a reply; nothing typed is stored or logged', async () => {
    const lines: string[] = [];
    const { server, tab, record, recorded, claudeConfig } = await startTerminalServer({ lines });
    const { repo, ids, sessionId } = await answeredChat(server, tab);
    const ref = server.core.entities.getSession(sessionId)!.adapterRefs[AGENT_SESSION_REF]!;
    // The chat's own exchange in Claude Code's record, as the real agent leaves it (the fake ACP agent writes none).
    const recordFolder = join(claudeConfig, 'projects', projectSlug(realpathSync.native(repo)));
    mkdirSync(recordFolder, { recursive: true });
    writeFileSync(
      join(recordFolder, `${ref}.jsonl`),
      [
        { type: 'user', uuid: 'chat-u1', parentUuid: null, isSidechain: false, sessionId: ref, message: { role: 'user', content: 'first question' } },
        { type: 'assistant', uuid: 'chat-a1', parentUuid: 'chat-u1', isSidechain: false, sessionId: ref, message: { role: 'assistant', content: [{ type: 'text', text: 'the chat reply' }] } },
      ]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(''),
    );

    const switched = await switchTo(server, tab, ids, 'terminal');
    expect(switched.status).toBe(200);
    expect(SessionResponse.parse(await switched.json()).session.driver).toBe('terminal');
    await waitFor(recorded, 'the CLI to start', 10_000);
    const cli = record();
    expect(cli).toMatchObject({ argv: ['--resume', ref, '--permission-mode', 'default'], cwd: realpathSync.native(repo), term: 'xterm-256color' });
    // The chat's environment, and none of the server's own beyond it (AD-16).
    expect(cli.envNames).toContain('CLAUDE_CODE_EXECUTABLE');
    expect(cli.envNames).not.toContain('OGDEN_AGENTS_TEST_SECRET_STORE');

    // Chat input is refused while the terminal drives (AD-6).
    const refused = await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'hello?' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('driver_is_terminal');

    const viewer = openTerminal(server, tab, sessionId);
    await viewer.opened;
    expect(viewer.state.protocol).toBe('ogden.v1');
    await waitFor(() => viewer.state.output.includes(`fake-claude:--resume,${ref}`), 'the CLI’s first output', 10_000);
    viewer.type(`${MARKER}\r`);
    await waitFor(() => viewer.state.output.includes(`echo:${MARKER}`), 'the echo', 10_000);
    const beforeBack = server.core.events.lastSeq();

    const back = await switchTo(server, tab, ids, 'ui');
    expect(back.status).toBe(200);
    expect(SessionResponse.parse(await back.json()).session.driver).toBe('ui');
    await waitFor(() => viewer.state.closed !== undefined, 'the terminal socket to close', 10_000);
    expect(viewer.state.frames).toEqual([{ type: 'exit', exitCode: null }]);
    expect(viewer.state.closed).toBe(TERMINAL_CLOSE.ended);
    await waitFor(() => !alive(cli.pid), 'the CLI to be gone', 10_000);
    expect(driverChanges(server, sessionId)).toEqual(['terminal', 'ui']);
    expect(driverCauses(server, sessionId)).toEqual(['user', 'user']);
    // The line typed in the terminal and its reply are in the chat, once, before the switch back (story 3.3):
    // text only (no thinking, tool call or sidechain), the user's from the terminal.
    expect(appendedSince(server, sessionId, beforeBack)).toEqual([
      ['user', MARKER, 'terminal'],
      ['agent', `echo:${MARKER}`, undefined],
      ['session.driver_changed'],
    ]);

    // The next message goes to the same session and is answered (after the imported reply).
    expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'and now?' })).status).toBe(202);
    await waitFor(() => stateOf(server, sessionId) === 'idle' && replies(server, sessionId).length === 3, 'the next reply', 15_000);
    expect(server.core.entities.getSession(sessionId)!.adapterRefs[AGENT_SESSION_REF]).toBe(ref);

    // Again, with a second line: the first is not imported twice, and the agent's own chat turns never are.
    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    const again = openTerminal(server, tab, sessionId);
    await again.opened;
    await waitFor(() => again.state.output.includes('ready>'), 'the prompt again', 10_000);
    again.type(`${MARKER}-2\r`);
    await waitFor(() => again.state.output.includes(`echo:${MARKER}-2`), 'the second echo', 10_000);
    expect((await switchTo(server, tab, ids, 'ui')).status).toBe(200);
    const messages = completed(server, sessionId);
    expect(messages).toEqual([
      ['user', 'first question', undefined],
      ['agent', expect.any(String), undefined],
      ['user', MARKER, 'terminal'],
      ['agent', `echo:${MARKER}`, undefined],
      ['user', 'and now?', undefined],
      ['agent', expect.any(String), undefined],
      ['user', `${MARKER}-2`, 'terminal'],
      ['agent', `echo:${MARKER}-2`, undefined],
    ]);

    // A reloaded page gets them from the event log like any message.
    const reloaded = await historyOf(server, tab, ids.wsId);
    expect(reloaded.filter((e) => e.type === 'session.message_completed' && e.payload.origin === 'terminal').map((e) => e.type === 'session.message_completed' && e.payload.content)).toEqual([
      MARKER,
      `${MARKER}-2`,
    ]);

    // The marker is in no log line and no log file (AD-16): only the event log, as a message, holds it.
    expect(lines.join('\n')).not.toContain(MARKER);
    expect(lines.join('\n')).not.toContain('fake-claude:--resume');
    const logs = join(server.dataDir, LOG_DIR);
    for (const file of existsSync(logs) ? filesUnder(logs) : []) expect(readFileSync(file).includes(MARKER), file).toBe(false);
    // What only the terminal showed or the CLI recorded beside the text (its prompt, thinking, tool output,
    // sidechain) is in no file of the data folder: database, its WAL, logs (review F8).
    for (const file of filesUnder(server.dataDir)) {
      const bytes = readFileSync(file);
      for (const only of ['ready>', `thinking about ${MARKER}`, 'tool-output', 'sidechain-text', 'the chat reply']) expect(bytes.includes(only), `${only} in ${file}`).toBe(false);
    }
  }, 90_000);

  it('attach sizes the terminal before anything is sent; nothing typed before it counts; resize frames resize it', async () => {
    const { server, tab, recorded } = await startTerminalServer();
    const { ids, sessionId } = await answeredChat(server, tab);
    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    await waitFor(recorded, 'the CLI to start', 10_000);
    const viewer = openTerminal(server, tab, sessionId, false);
    await viewer.opened;
    // Before `attach` (story 3.5): no output is sent, and bytes and resizes are ignored.
    viewer.type('before-attach\r');
    viewer.control({ type: 'resize', cols: 60, rows: 15 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(viewer.state.raw).toBe('');
    viewer.control({ type: 'attach', cols: 102, rows: 32 });
    await waitFor(() => viewer.state.output.includes('ready>'), 'the recent output', 10_000);
    await waitFor(() => viewer.state.output.includes('resized=102x32'), 'the attach size to reach the CLI', 10_000);
    viewer.control({ type: 'resize', cols: 101, rows: 31 });
    // A resize can apply after input already on its way: ask until it shows.
    for (let tries = 0; tries < 20 && !viewer.state.output.includes('size=101x31'); tries++) {
      viewer.type('size\r');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(viewer.state.output).toContain('size=101x31');
    expect(viewer.state.output).not.toContain('before-attach');
    expect(viewer.state.output).not.toContain('60x15');
    // A malformed attach is ignored: the socket stays open and the size stays.
    const asked = (output: string) => output.split('\nsize=101x31').length - 1;
    const before = asked(viewer.state.output);
    viewer.control({ type: 'attach', cols: 0, rows: 32 });
    viewer.type('size\r');
    await waitFor(() => asked(viewer.state.output) > before, 'the size asked again', 10_000);
    expect(viewer.state.closed).toBeUndefined();
    // The one viewer was never told a size: it set every one.
    expect(viewer.state.frames).toEqual([]);
  }, 60_000);

  it('two viewers of one CLI: each types and resizes, both see all the output, the size follows the last; nothing typed is evented, stored or logged (story 3.5)', async () => {
    const lines: string[] = [];
    const { server, tab, recorded } = await startTerminalServer({ lines });
    const { ids, sessionId } = await answeredChat(server, tab);
    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    await waitFor(recorded, 'the CLI to start', 10_000);
    const sizeFrames = (viewer: ReturnType<typeof openTerminal>) => viewer.state.frames.filter((frame) => (frame as { type: string }).type === 'size');
    const a = openTerminal(server, tab, sessionId, { cols: 100, rows: 30 });
    await a.opened;
    await waitFor(() => a.state.output.includes('ready>'), 'the prompt', 10_000);
    const b = openTerminal(server, tab, sessionId, { cols: 90, rows: 20 });
    await b.opened;
    // B gets the recent output; A is told the terminal took B's size.
    await waitFor(() => b.state.output.includes('ready>'), 'the recent output', 10_000);
    await waitFor(() => sizeFrames(a).length === 1, 'A to be told the size', 10_000);
    expect(sizeFrames(a)).toEqual([{ type: 'size', cols: 90, rows: 20 }]);

    // A types: the terminal takes A's size again and both are told; both see the echo.
    const eventsBefore = server.core.events.lastSeq();
    a.type(`${MARKER}-a\r`);
    await waitFor(() => a.state.output.includes(`echo:${MARKER}-a`) && b.state.output.includes(`echo:${MARKER}-a`), 'both to see A’s echo', 10_000);
    await waitFor(() => sizeFrames(b).length === 1, 'B to be told A’s size', 10_000);
    expect(sizeFrames(b)).toEqual([{ type: 'size', cols: 100, rows: 30 }]);
    expect(sizeFrames(a).at(-1)).toEqual({ type: 'size', cols: 100, rows: 30 });

    // B types: B's size.
    b.type(`${MARKER}-b\r`);
    await waitFor(() => a.state.output.includes(`echo:${MARKER}-b`) && b.state.output.includes(`echo:${MARKER}-b`), 'both to see B’s echo', 10_000);
    b.type('size\r');
    await waitFor(() => a.state.output.includes('size=90x20') && b.state.output.includes('size=90x20'), 'B’s size to reach the CLI', 10_000);

    // A resizes: B is told, A is not; the CLI has A's new size.
    const aFrames = sizeFrames(a).length;
    a.control({ type: 'resize', cols: 110, rows: 35 });
    await waitFor(() => sizeFrames(b).at(-1) !== undefined && JSON.stringify(sizeFrames(b).at(-1)) === JSON.stringify({ type: 'size', cols: 110, rows: 35 }), 'B to be told A’s resize', 10_000);
    expect(sizeFrames(a).length).toBe(aFrames);
    for (let tries = 0; tries < 20 && !b.state.output.includes('size=110x35'); tries++) {
      a.type('size\r');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(b.state.output).toContain('size=110x35');

    // While the terminal drives, what was typed is in no event, no file of the data folder and no log line (AD-16).
    expect(JSON.stringify(server.core.events.readAfter(eventsBefore))).not.toContain(MARKER);
    for (const file of filesUnder(server.dataDir)) expect(readFileSync(file).includes(MARKER), file).toBe(false);
    expect(lines.join('\n')).not.toContain(MARKER);
    expect(a.state.closed).toBeUndefined();
    expect(b.state.closed).toBeUndefined();
    await server.close();
    expect(lines.join('\n')).not.toContain(MARKER);
    const logs = join(server.dataDir, LOG_DIR);
    for (const file of existsSync(logs) ? filesUnder(logs) : []) expect(readFileSync(file).includes(MARKER), file).toBe(false);
  }, 90_000);

  it('a CLI that exits by itself gives the chat back and tells the viewer its exit code', async () => {
    const { server, tab } = await startTerminalServer();
    const { ids, sessionId } = await answeredChat(server, tab);
    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    const viewer = openTerminal(server, tab, sessionId);
    await viewer.opened;
    await waitFor(() => viewer.state.output.includes('ready>'), 'the prompt', 10_000);
    viewer.type('/exit\r');
    await waitFor(() => viewer.state.closed !== undefined, 'the terminal socket to close', 10_000);
    expect(viewer.state.frames).toEqual([{ type: 'exit', exitCode: 0 }]);
    // Its turns are imported first (story 3.4), then the chat drives.
    await waitFor(() => server.core.entities.getSession(sessionId)!.driver === 'ui', 'the chat to drive', 10_000);
    expect(driverChanges(server, sessionId)).toEqual(['terminal', 'ui']);
    expect(driverCauses(server, sessionId)).toEqual(['user', 'cli_exited']);
  }, 60_000);

  it('a CLI that crashes gives the chat back with a note, tells the viewer its exit code, and leaves nothing it started running (stories 3.2, 3.4)', async () => {
    const { server, tab, record, recorded } = await startTerminalServer({ extraAgentEnv: grandchildEnv() });
    const { ids, sessionId } = await answeredChat(server, tab);
    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    await waitFor(recorded, 'the CLI to start', 10_000);
    const { pid, grandchild } = record();
    const viewer = openTerminal(server, tab, sessionId);
    await viewer.opened;
    await waitFor(() => viewer.state.output.includes('ready>'), 'the prompt', 10_000);
    viewer.type('crash\r');
    await waitFor(() => viewer.state.closed !== undefined, 'the terminal socket to close', 10_000);
    expect(viewer.state.frames).toEqual([{ type: 'exit', exitCode: 70 }]);
    await waitFor(() => server.core.entities.getSession(sessionId)!.driver === 'ui', 'the chat to drive', 10_000);
    expect(driverCauses(server, sessionId)).toEqual(['user', 'cli_exited']);
    expect(replies(server, sessionId).at(-1)).toMatchObject({ payload: { content: "Claude Code's terminal closed unexpectedly (exit code 70)." } });
    expect(alive(pid)).toBe(false);
    // What it started is stopped with it (POSIX: its group; Windows: the fake's libuv job, story 3.8).
    if (grandchild !== null) await waitFor(() => !alive(grandchild), 'what the CLI started to be gone', 10_000);
    // And the chat answers again.
    expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'after the crash' })).status).toBe(202);
    await waitFor(() => stateOf(server, sessionId) === 'idle' && replies(server, sessionId).length === 3, 'the next reply', 15_000);
  }, 60_000);

  it('a CLI that crashes on start gives the chat back with a note; the chat answers again (story 3.4)', async () => {
    const { server, tab, record, recorded } = await startTerminalServer({ extraAgentEnv: grandchildEnv({ FAKE_CLAUDE_CRASH_ON_START: '1' }) });
    const { ids, sessionId } = await answeredChat(server, tab);
    // Whether the crash is heard before or after the switch answers, the chat drives in the end.
    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    await waitFor(recorded, 'the CLI to start', 10_000);
    await waitFor(() => server.core.entities.getSession(sessionId)!.driver === 'ui' && driverCauses(server, sessionId).length === 2, 'the chat to drive', 10_000);
    expect(driverCauses(server, sessionId)).toEqual(['user', 'cli_exited']);
    expect(replies(server, sessionId).at(-1)).toMatchObject({ payload: { content: "Claude Code's terminal closed unexpectedly (exit code 70)." } });
    const { grandchild } = record();
    if (grandchild !== null) await waitFor(() => !alive(grandchild), 'what the CLI started to be gone', 10_000);
    expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'after the crash' })).status).toBe(202);
    await waitFor(() => stateOf(server, sessionId) === 'idle' && replies(server, sessionId).length === 3, 'the next reply', 15_000);
  }, 60_000);

  it('closing the viewer leaves the CLI running; a new viewer gets the recent output; the server stop kills it', async () => {
    const { server, tab, record, recorded } = await startTerminalServer();
    const { ids, sessionId } = await answeredChat(server, tab);
    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    await waitFor(recorded, 'the CLI to start', 10_000);
    const first = openTerminal(server, tab, sessionId);
    await first.opened;
    first.type('before\r');
    await waitFor(() => first.state.output.includes('echo:before'), 'the echo', 10_000);
    first.ws.close();
    await waitFor(() => first.state.closed !== undefined, 'the first viewer to close', 10_000);
    const { pid } = record();
    expect(alive(pid)).toBe(true);

    const second = openTerminal(server, tab, sessionId);
    await second.opened;
    await waitFor(() => second.state.output.includes('echo:before'), 'the recent output', 10_000);

    await server.close();
    await waitFor(() => !alive(pid), 'the CLI to be gone', 10_000);
  }, 60_000);

  it('closes a viewer that falls a megabyte behind a flooding CLI (1013); the CLI runs on and a new viewer gets the recent output (review F2)', async () => {
    const lines: string[] = [];
    const { server, tab, record, recorded } = await startTerminalServer({ lines });
    const { ids, sessionId } = await answeredChat(server, tab);
    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    await waitFor(recorded, 'the CLI to start', 10_000);
    const slow = openTerminal(server, tab, sessionId);
    await slow.opened;
    await waitFor(() => slow.state.output.includes('ready>'), 'the prompt', 10_000);
    slow.type('flood\r');
    // This viewer stops reading: what the server sends it piles up.
    slow.ws.pause();
    await waitFor(() => lines.some((line) => line.includes('terminal viewer fell behind')), 'the slow viewer to be closed', 30_000);
    slow.ws.resume();
    await waitFor(() => slow.state.closed !== undefined, 'the slow viewer to close', 30_000);
    expect(slow.state.closed).toBe(TERMINAL_CLOSE.slowViewer);
    expect(alive(record().pid)).toBe(true);
    expect(server.core.entities.getSession(sessionId)!.driver).toBe('terminal');

    const next = openTerminal(server, tab, sessionId);
    await next.opened;
    await waitFor(() => next.state.output.includes('xxxx'), 'the recent output', 10_000);
  }, 90_000);

  it('closes a viewer of a session the terminal does not drive, or an unknown one, and one that sends an oversize frame', async () => {
    const { server, tab } = await startTerminalServer();
    const { ids, sessionId } = await answeredChat(server, tab);
    for (const id of [sessionId, 'ses_00000000000000000000000000', 'not-an-id']) {
      const viewer = openTerminal(server, tab, id);
      await viewer.opened;
      await waitFor(() => viewer.state.closed !== undefined, `the socket for ${id} to close`, 10_000);
      expect(viewer.state.closed, id).toBe(TERMINAL_CLOSE.notTerminal);
    }

    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    const viewer = openTerminal(server, tab, sessionId);
    await viewer.opened;
    viewer.ws.send(Buffer.alloc(MAX_TERMINAL_INPUT_BYTES + 1, 0x61), { binary: true });
    await waitFor(() => viewer.state.closed !== undefined, 'the socket to close', 10_000);
    expect(viewer.state.closed).toBe(1009);
    // The terminal itself runs on.
    expect(server.core.entities.getSession(sessionId)!.driver).toBe('terminal');
  }, 60_000);

  it("starts the CLI in the chat's permission mode, refuses a mode change while it drives, and Developer mode off stops a Skip-all CLI (permission modes)", async () => {
    const { server, tab, record, recorded } = await startTerminalServer();
    const { ids, sessionId } = await answeredChat(server, tab);
    const ref = server.core.entities.getSession(sessionId)!.adapterRefs[AGENT_SESSION_REF]!;
    const put = (path: string, body: unknown) => fetch(`${server.url}${path}`, { method: 'PUT', headers: { ...tab.headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await put(API_ROUTES.developerMode, { developerMode: true })).status).toBe(200);
    expect((await put(apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'skip_all', confirm: true })).status).toBe(200);

    expect((await switchTo(server, tab, ids, 'terminal')).status).toBe(200);
    await waitFor(recorded, 'the CLI to start', 10_000);
    const cli = record();
    expect(cli.argv).toEqual(['--resume', ref, '--dangerously-skip-permissions']);
    const refused = await put(apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'ask' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('driver_is_terminal');

    // Developer mode off: the chat drives again, in Ask, and the CLI skipping its checks is gone.
    expect((await put(API_ROUTES.developerMode, { developerMode: false })).status).toBe(200);
    expect(server.core.entities.getSession(sessionId)).toMatchObject({ driver: 'ui', permissionMode: 'ask' });
    expect(driverCauses(server, sessionId).at(-1)).toBe('developer_mode_off');
    await waitFor(() => !alive(cli.pid), 'the CLI to be gone', 10_000);
  }, 60_000);
});

/** A Claude-Code-like agent that answers at once and whose sessions resume in its CLI (for the in-memory terminal). */
function resumingAgent(): AgentPort {
  let sessions = 0;
  const open = (agentSessionId: string): AgentSession => {
    const listeners = new Set<(event: AgentEvent) => void>();
    return {
      agentSessionId,
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text) {
        for (const listener of [...listeners]) listener({ type: 'message_chunk', text: `re: ${text}` });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {},
    };
  };
  return {
    displayName: 'Claude Code',
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    startSession: async () => open(`agent-${++sessions}`),
    reopenSession: async (input) => ({ session: open(input.agentSessionId), restored: 'resumed' }),
    terminalResume: {
      command: async (id, env) => ({ file: 'claude', args: ['--resume', id], env: { ...env } }),
      locate: async () => ({ found: true }),
    },
  };
}

/**
 * The terminal socket alone (story 3.5), on a real chat whose terminal is
 * `terminal-memory` (no echo: what is typed is only recorded): no PTY, so
 * these run everywhere. The gate is not in front of it (gate.test.ts and
 * the tests above check the upgrade); the in-memory socket offers no token.
 */
async function socketOnMemoryTerminal(options: { now?: () => number; attachWaitMs?: number } = {}) {
  const core = openCore(tempDataDir());
  const terminal = createMemoryTerminalPort({ echo: false });
  const chat = createChat({ dataDir: tempDataDir(), entities: core.entities, sessionEvents: core.sessionEvents, agent: resumingAgent(), terminal });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  const session = chat.createChatSession(workspace.id);
  chat.sendMessage(workspace.id, session.id, 'first question');
  await chat.settled();
  expect((await chat.switchDriver(workspace.id, session.id, 'terminal')).driver).toBe('terminal');
  const lines: string[] = [];
  const app = new Hono();
  registerTerminalSocket(app, { chat, log: createLogger((line) => void lines.push(line)), ...options });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });
  const http = createAdaptorServer({ fetch: app.fetch, websocket: { server: wss } });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  stops.push(async () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await chat.close();
    core.close();
  });
  return {
    chat,
    core,
    workspace,
    session,
    cli: terminal.opened[0]!,
    lines,
    open: (attach: { cols: number; rows: number } | false = { cols: 80, rows: 24 }) => viewerOn(`ws://127.0.0.1:${port}/ws/terminal/${session.id}`, undefined, attach),
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the terminal socket: attach, several viewers, the typing limit (story 3.5, in-memory terminal)', () => {
  it('sends the recent output only after attach, ignores bytes and resizes before it, and tells the other viewers the new size', async () => {
    const { cli, open } = await socketOnMemoryTerminal();
    cli.print('earlier output\r\n');
    const a = open({ cols: 100, rows: 30 });
    await a.opened;
    await waitFor(() => a.state.output === 'earlier output\r\n', 'A’s recent output');
    expect(cli.resizes).toEqual([{ cols: 100, rows: 30 }]);

    const b = open(false);
    await b.opened;
    b.type('too early');
    b.control({ type: 'resize', cols: 50, rows: 10 });
    await pause(200);
    expect(b.state.raw).toBe('');
    expect(cli.writes).toEqual([]);
    expect(cli.resizes).toHaveLength(1);

    b.control({ type: 'attach', cols: 90, rows: 20 });
    await waitFor(() => b.state.output === 'earlier output\r\n', 'B’s recent output');
    await waitFor(() => a.state.frames.length === 1, 'A to be told the size');
    expect(a.state.frames).toEqual([{ type: 'size', cols: 90, rows: 20 }]);
    expect(b.state.frames).toEqual([]);
    expect(cli.resizes.at(-1)).toEqual({ cols: 90, rows: 20 });

    cli.print('live');
    await waitFor(() => a.state.output.endsWith('live') && b.state.output.endsWith('live'), 'both to see live output');

    // A resizes: B is told, A is not. Then B types: B's size again, and both are told.
    a.control({ type: 'resize', cols: 110, rows: 35 });
    await waitFor(() => b.state.frames.length === 1, 'B to be told A’s resize');
    expect(b.state.frames).toEqual([{ type: 'size', cols: 110, rows: 35 }]);
    b.type('hi');
    await waitFor(() => cli.writes.join('') === 'hi', 'B’s typing');
    expect(cli.resizes.at(-1)).toEqual({ cols: 90, rows: 20 });
    await waitFor(() => a.state.frames.length === 2 && b.state.frames.length === 2, 'both to be told B’s size');
    expect(a.state.frames.at(-1)).toEqual({ type: 'size', cols: 90, rows: 20 });
    expect(b.state.frames.at(-1)).toEqual({ type: 'size', cols: 90, rows: 20 });
    // A second attach is a resize.
    b.control({ type: 'attach', cols: 91, rows: 21 });
    await waitFor(() => a.state.frames.length === 3, 'A to be told');
    expect(b.state.output).toBe('earlier output\r\nlive');
  });

  it(`attaches a viewer that sends no attach within the wait (${ATTACH_WAIT_MS} ms) at the terminal's size, and tells it that size`, async () => {
    expect(ATTACH_WAIT_MS).toBe(5_000);
    const { cli, open } = await socketOnMemoryTerminal({ attachWaitMs: 200 });
    cli.print('earlier');
    const viewer = open(false);
    await viewer.opened;
    await waitFor(() => viewer.state.output === 'earlier', 'the recent output after the wait');
    expect(viewer.state.frames).toEqual([{ type: 'size', cols: 80, rows: 24 }]);
    expect(cli.resizes).toEqual([]);
    viewer.type('late');
    await waitFor(() => cli.writes.join('') === 'late', 'its typing');
    // It never sized the terminal: its typing doesn't resize it.
    expect(cli.resizes).toEqual([]);
  });

  it('closes a viewer that types over its budget (1008 rate_limited), logging only the count; the CLI and the other viewer go on', async () => {
    // A clock that never moves: no refill.
    const { cli, open, lines, core, session } = await socketOnMemoryTerminal({ now: () => 0 });
    const flooder = open();
    const other = open();
    await Promise.all([flooder.opened, other.opened]);
    await pause(100);
    // Its `attach` cost one control frame: the fourth full chunk no longer fits.
    const chunk = Buffer.alloc(MAX_TERMINAL_INPUT_BYTES, MARKER);
    for (let sent = 0; sent < INPUT_BURST_BYTES; sent += chunk.byteLength) flooder.ws.send(chunk, { binary: true });
    await waitFor(() => flooder.state.closed !== undefined, 'the flooder to be closed', 10_000);
    expect(flooder.state.closed).toBe(1008);
    expect(cli.writes.join('').length).toBe(INPUT_BURST_BYTES - MAX_TERMINAL_INPUT_BYTES);
    expect(lines.filter((line) => line.includes('typed too fast'))).toHaveLength(1);
    expect(lines.join('\n')).not.toContain(MARKER);
    // The CLI runs on, and the other viewer still types and sees output.
    expect(cli.exitCode).toBeUndefined();
    expect(core.entities.getSession(session.id)!.driver).toBe('terminal');
    other.type('still here');
    await waitFor(() => cli.writes.at(-1) === 'still here', 'the other viewer’s typing');
    cli.print('output');
    await waitFor(() => other.state.output.endsWith('output'), 'the other viewer’s output');
    expect(other.state.closed).toBeUndefined();
  });

  it('charges each control frame against the same budget, so resizing in a loop is closed 1008 too (review F3)', async () => {
    const { cli, open, lines } = await socketOnMemoryTerminal({ now: () => 0 });
    const flapper = open({ cols: 100, rows: 30 });
    const other = open();
    await Promise.all([flapper.opened, other.opened]);
    await pause(100);
    // The attach took one frame's cost: this many more fit, and one more doesn't.
    const fit = INPUT_BURST_BYTES / CONTROL_FRAME_COST_BYTES - 1;
    for (let i = 0; i < fit; i++) flapper.control({ type: 'resize', cols: 100 + (i % 2), rows: 30 });
    await pause(300);
    expect(flapper.state.closed).toBeUndefined();
    flapper.control({ type: 'resize', cols: 120, rows: 40 });
    await waitFor(() => flapper.state.closed !== undefined, 'the flapper to be closed', 10_000);
    expect(flapper.state.closed).toBe(1008);
    expect(cli.resizes.some((size) => size.cols === 120)).toBe(false);
    expect(lines.filter((line) => line.includes('control frames too fast'))).toHaveLength(1);
    expect(other.state.closed).toBeUndefined();
  });

  it(`closes a viewer over the session's limit of ${MAX_TERMINAL_VIEWERS} (${TERMINAL_TOO_MANY_VIEWERS}); one that leaves frees its place (review F2)`, async () => {
    const { cli, open } = await socketOnMemoryTerminal();
    cli.print('shown');
    const viewers = Array.from({ length: MAX_TERMINAL_VIEWERS }, () => open());
    await Promise.all(viewers.map((viewer) => viewer.opened));
    await waitFor(() => viewers.every((viewer) => viewer.state.output === 'shown'), 'every viewer to attach');
    const extra = open();
    await extra.opened;
    await waitFor(() => extra.state.closed !== undefined, 'the extra viewer to be closed');
    expect(extra.state.closed).toBe(TERMINAL_TOO_MANY_VIEWERS);
    expect(extra.state.raw).toBe('');
    expect(viewers.every((viewer) => viewer.state.closed === undefined)).toBe(true);
    viewers[0]!.ws.close();
    await waitFor(() => viewers[0]!.state.closed !== undefined, 'a viewer to leave');
    const next = open();
    await next.opened;
    await waitFor(() => next.state.output === 'shown', 'a new viewer in its place');
    expect(next.state.closed).toBeUndefined();
  });

  it('closing a socket only detaches its viewer: the CLI runs on with no viewer, and a new one (a reload) gets the recent output', async () => {
    const { cli, open, core, session } = await socketOnMemoryTerminal();
    const first = open({ cols: 100, rows: 30 });
    await first.opened;
    cli.print('before the reload');
    await waitFor(() => first.state.output === 'before the reload', 'the output');
    first.ws.close();
    await waitFor(() => first.state.closed !== undefined, 'the close');
    cli.print(' / while away');
    await pause(100);
    expect(cli.exitCode).toBeUndefined();
    expect(cli.kills).toBe(0);
    expect(core.entities.getSession(session.id)!.driver).toBe('terminal');
    const again = open({ cols: 100, rows: 30 });
    await again.opened;
    await waitFor(() => again.state.output === 'before the reload / while away', 'the recent output');
  });

  it('when the terminal ends every viewer gets exit, then 4000', async () => {
    const { chat, workspace, session, open } = await socketOnMemoryTerminal();
    const a = open();
    const b = open(false);
    await Promise.all([a.opened, b.opened]);
    await pause(100);
    expect((await chat.switchDriver(workspace.id, session.id, 'ui')).driver).toBe('ui');
    await waitFor(() => a.state.closed !== undefined && b.state.closed !== undefined, 'both to close');
    for (const viewer of [a, b]) {
      expect(viewer.state.frames).toEqual([{ type: 'exit', exitCode: null }]);
      expect(viewer.state.closed).toBe(TERMINAL_CLOSE.ended);
    }
  });
});

describe('the typing budget (story 3.5; fake timers)', () => {
  it(`takes a burst of ${INPUT_BURST_BYTES} bytes, then refills at ${INPUT_BYTES_PER_SECOND} a second, never above the burst`, () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const budget = createInputBudget(INPUT_BURST_BYTES, INPUT_BYTES_PER_SECOND);
    expect(budget.take(INPUT_BURST_BYTES)).toBe(true);
    expect(budget.take(1)).toBe(false);
    vi.advanceTimersByTime(500);
    expect(budget.take(INPUT_BYTES_PER_SECOND / 2)).toBe(true);
    expect(budget.take(1)).toBe(false);
    // A long quiet refills only up to the burst.
    vi.advanceTimersByTime(60_000);
    expect(budget.take(INPUT_BURST_BYTES)).toBe(true);
    expect(budget.take(1)).toBe(false);
    // Steady typing within the rate is never refused.
    for (let second = 0; second < 10; second++) {
      vi.advanceTimersByTime(1_000);
      expect(budget.take(INPUT_BYTES_PER_SECOND)).toBe(true);
    }
  });
});
