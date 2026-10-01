/**
 * A chat switched to its agent's own terminal and back (story 3.1), end to
 * end: a real server, the fake ACP agent as the chat's agent, and the fake
 * CLI (`tests/fixtures/fake-claude-cli.mjs`, as `CLAUDE_CODE_EXECUTABLE`) in
 * the real `node-pty`, over `/ws/terminal/:sesId`. No test runs the real
 * `claude`. The gate's refusals of the terminal socket are in gate.test.ts.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPty, stripTerminalEscapes } from '@ogden-agents/adapters';
import { AGENT_SESSION_REF, openCore } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  MAX_TERMINAL_INPUT_BYTES,
  SessionResponse,
  TERMINAL_CLOSE,
  WorkspaceResponse,
  type SessionId,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MAX_WS_PAYLOAD_BYTES, type StartOptions } from '../src/start.js';
import { signIn, startTestServer, tempDataDir, trackSocket, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures');
const FAKE_CLI = join(FIXTURES, 'fake-claude-cli.mjs');
const MARKER = 'terminal-marker-5b1e0d';

const dirs: string[] = [];
const servers: TestServer[] = [];
// Servers first (closing one stops its agents and terminals), then the folders they ran in.
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
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
  term: string;
  envNames: string[];
}

/**
 * A server whose chat agent is the fake ACP agent (resuming sessions) and
 * whose terminal runs the fake CLI, recording to `record`. Never the real `claude`.
 */
async function startTerminalServer(options: StartOptions & { lines?: string[] } = {}) {
  const record = join(tempDir('ogden-agents-cli-'), 'record.json');
  const server = await startTestServer({
    extraAgentEnv: { CLAUDE_CODE_EXECUTABLE: FAKE_CLI, FAKE_CLAUDE_RECORD: record, FAKE_ACP_RESUME: 'resume' },
    ...options,
  });
  servers.push(server);
  return { server, tab: await signIn(server), record: () => JSON.parse(readFileSync(record, 'utf8')) as CliRecord, recorded: () => existsSync(record) };
}

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

const switchTo = (server: TestServer, tab: SignedIn, ids: { wsId: string; sesId: string }, driver: 'ui' | 'terminal') =>
  post(server, tab, apiPath(API_ROUTES.sessionDriver, ids), { driver });

/** A terminal viewer: the text of every binary frame, the control frames, and how it closed. */
function openTerminal(server: TestServer, tab: SignedIn, sessionId: string) {
  const ws = trackSocket(new WebSocket(`ws://127.0.0.1:${server.port}/ws/terminal/${sessionId}`, tab.protocols, { headers: { origin: tab.origin } }));
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
      resolve();
    });
    ws.once('unexpected-response', (_req, res) => reject(new Error(`upgrade refused: ${res.statusCode}`)));
  });
  return { ws, state, opened, type: (text: string) => ws.send(Buffer.from(text, 'utf8'), { binary: true }) };
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
    expect(ApiErrorBody.parse(await refused.json()).error.message).toContain('no prebuilt terminal for this platform');
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
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'session_busy', message: 'Send Claude Code a message first, then switch to the terminal.' });
    expect((await post(server, tab, apiPath(API_ROUTES.sessionDriver, ids), { driver: 'shell' })).status).toBe(400);
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
  it('opens the CLI on the same session in the project folder, carries bytes both ways, and back; the next message gets a reply; nothing typed is stored or logged', async () => {
    const lines: string[] = [];
    const { server, tab, record, recorded } = await startTerminalServer({ lines });
    const { repo, ids, sessionId } = await answeredChat(server, tab);
    const ref = server.core.entities.getSession(sessionId)!.adapterRefs[AGENT_SESSION_REF]!;

    const switched = await switchTo(server, tab, ids, 'terminal');
    expect(switched.status).toBe(200);
    expect(SessionResponse.parse(await switched.json()).session.driver).toBe('terminal');
    await waitFor(recorded, 'the CLI to start', 10_000);
    const cli = record();
    expect(cli).toMatchObject({ argv: ['--resume', ref], cwd: realpathSync.native(repo), term: 'xterm-256color' });
    // The chat's environment, and none of the server's own beyond it (AD-16).
    expect(cli.envNames).toContain('CLAUDE_CODE_EXECUTABLE');
    expect(cli.envNames).not.toContain('OGDEN_AGENTS_TEST_SECRET_STORE');

    // Chat input is refused while the terminal drives (AD-6).
    expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'hello?' })).status).toBe(400);

    const viewer = openTerminal(server, tab, sessionId);
    await viewer.opened;
    expect(viewer.state.protocol).toBe('ogden.v1');
    await waitFor(() => viewer.state.output.includes(`fake-claude:--resume,${ref}`), 'the CLI’s first output', 10_000);
    viewer.type(`${MARKER}\r`);
    await waitFor(() => viewer.state.output.includes(`echo:${MARKER}`), 'the echo', 10_000);
    viewer.ws.send(JSON.stringify({ type: 'resize', cols: 101, rows: 31 }));
    // ConPTY (Windows) applies a resize asynchronously, after input already on its way: ask until it shows.
    for (let tries = 0; tries < 20 && !viewer.state.output.includes('size=101x31'); tries++) {
      viewer.type('size\r');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(viewer.state.output).toContain('size=101x31');

    const back = await switchTo(server, tab, ids, 'ui');
    expect(back.status).toBe(200);
    expect(SessionResponse.parse(await back.json()).session.driver).toBe('ui');
    await waitFor(() => viewer.state.closed !== undefined, 'the terminal socket to close', 10_000);
    expect(viewer.state.frames).toEqual([{ type: 'exit', exitCode: null }]);
    expect(viewer.state.closed).toBe(TERMINAL_CLOSE.ended);
    await waitFor(() => !alive(cli.pid), 'the CLI to be gone', 10_000);
    expect(driverChanges(server, sessionId)).toEqual(['terminal', 'ui']);

    // The next message goes to the same session and is answered.
    expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, ids), { text: 'and now?' })).status).toBe(202);
    await waitFor(() => stateOf(server, sessionId) === 'idle' && replies(server, sessionId).length === 2, 'the next reply', 15_000);
    expect(server.core.entities.getSession(sessionId)!.adapterRefs[AGENT_SESSION_REF]).toBe(ref);

    // The marker is in no event, no file of the data folder (database, logs) and no log line (AD-16).
    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain(MARKER);
    expect(lines.join('\n')).not.toContain(MARKER);
    expect(lines.join('\n')).not.toContain('fake-claude:--resume');
    for (const file of filesUnder(server.dataDir)) expect(readFileSync(file).includes(MARKER), file).toBe(false);
  }, 60_000);

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
    expect(server.core.entities.getSession(sessionId)!.driver).toBe('ui');
    expect(driverChanges(server, sessionId)).toEqual(['terminal', 'ui']);
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
});
