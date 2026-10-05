/**
 * Terminal panes (epic 16, story 16.2), end to end: a real server, the fake
 * shell (`tests/fixtures/fake-pane-shell.mjs`, through the `paneShell` option)
 * in the real `node-pty`, over `/api/v1/workspaces/:wsId/panes` and
 * `/ws/pane/:paneId`. No test runs the user's shell or a CLI.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTerminalEscapes } from '@ogden-agents/adapters';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  PANE_CLOSE,
  PaneResponse,
  PanesResponse,
  WorkspaceResponse,
  type Pane,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { signIn, startTestServer, trackSocket, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_SHELL = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-pane-shell.mjs');
const MARKER = 'pane-marker-7c1d3e';

const dirs: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

interface Setup {
  server: TestServer;
  tab: SignedIn;
  repo: string;
  wsId: string;
  lines: string[];
  record: string;
}

/** A server whose panes run the fake shell, a project in a temp folder, and Developer mode on unless told. */
async function startPaneServer({ developerMode = true, shellFlags = [] as string[] } = {}): Promise<Setup> {
  const lines: string[] = [];
  const record = join(tempDir('ogden-agents-pane-'), 'record.json');
  const server = await startTestServer({ lines, paneShell: { file: process.execPath, args: [FAKE_SHELL, '--record', record, ...shellFlags] } });
  servers.push(server);
  const tab = await signIn(server);
  const repo = tempDir('ogden-agents-repo-');
  const response = await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...tab.headers, 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }) });
  const { workspace } = WorkspaceResponse.parse(await response.json());
  if (developerMode) server.core.installSettings.setDeveloperMode(true);
  return { server, tab, repo, wsId: workspace.id, lines, record };
}

const panesUrl = ({ server, wsId }: Setup) => `${server.url}${apiPath(API_ROUTES.workspacePanes, { wsId })}`;
const paneUrl = ({ server, wsId }: Setup, paneId: string) => `${server.url}${apiPath(API_ROUTES.workspacePane, { wsId, paneId })}`;
const jsonHeaders = (tab: SignedIn) => ({ ...tab.headers, 'content-type': 'application/json' });

async function openPane(setup: Setup, size = { cols: 100, rows: 30 }): Promise<Pane> {
  const response = await fetch(panesUrl(setup), { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify(size) });
  expect(response.status).toBe(201);
  return PaneResponse.parse(await response.json()).pane;
}

/** A pane viewer: what is on the screen (every binary frame since the last `reset`), the control frames, and how it closed. */
function viewPane(setup: Setup, paneId: string, attach: { cols: number; rows: number } | false = { cols: 100, rows: 30 }) {
  const ws = trackSocket(new WebSocket(`ws://127.0.0.1:${setup.server.port}/ws/pane/${paneId}`, setup.tab.protocols, { headers: { origin: setup.tab.origin } }));
  const state = {
    raw: '',
    get output() {
      return stripTerminalEscapes(this.raw);
    },
    frames: [] as Array<{ type: string; [key: string]: unknown }>,
    closed: undefined as number | undefined,
  };
  const decoder = new TextDecoder();
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      state.raw += decoder.decode(data as Buffer, { stream: true });
      return;
    }
    const frame = JSON.parse(String(data)) as { type: string };
    state.frames.push(frame);
    // A reset says what follows replaces the screen.
    if (frame.type === 'reset') state.raw = '';
  });
  ws.on('close', (code) => (state.closed = code));
  ws.on('error', () => {});
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      if (attach !== false) ws.send(JSON.stringify({ type: 'attach', ...attach }));
      resolve();
    });
    ws.once('unexpected-response', (_req, res) => reject(new Error(`upgrade refused: ${res.statusCode}`)));
  });
  return { ws, state, opened, type: (text: string) => ws.send(Buffer.from(text, 'utf8'), { binary: true }) };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const recordOf = (setup: Setup) => JSON.parse(readFileSync(setup.record, 'utf8')) as { cwd: string; pid: number; grandchild: number | null; term: string | null; colorterm: string | null; envNames: string[] };

describe('Developer mode gates every pane route and socket (E16-R3)', () => {
  it('refuses 403 developer_mode_required with it off, and opens nothing', async () => {
    const setup = await startPaneServer({ developerMode: false });
    const attempts = [
      fetch(panesUrl(setup), { headers: setup.tab.headers }),
      fetch(panesUrl(setup), { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ cols: 80, rows: 24 }) }),
      fetch(paneUrl(setup, 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3'), { method: 'DELETE', headers: setup.tab.headers }),
      fetch(`${paneUrl(setup, 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3')}/restart`, { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ cols: 80, rows: 24 }) }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe('developer_mode_required');
    }
    expect(existsSync(setup.record)).toBe(false);
  }, 30_000);

  it('closes the pane socket 4403 with it off, even for a pane that existed', async () => {
    const setup = await startPaneServer();
    const pane = await openPane(setup);
    setup.server.core.installSettings.setDeveloperMode(false);
    const viewer = viewPane(setup, pane.id);
    await viewer.opened;
    await waitFor(() => viewer.state.closed !== undefined, 'the socket to close');
    expect(viewer.state.closed).toBe(PANE_CLOSE.developerModeOff);
  }, 30_000);

  it('stops every running pane when Developer mode is turned off', async () => {
    const setup = await startPaneServer({ shellFlags: ['--grandchild'] });
    await openPane(setup);
    await waitFor(() => existsSync(setup.record), 'the shell to start', 15_000);
    const { pid, grandchild } = recordOf(setup);
    expect(alive(pid)).toBe(true);
    setup.server.core.installSettings.setDeveloperMode(false);
    await waitFor(() => !alive(pid) && !alive(grandchild!), 'the pane and what it started to stop', 15_000);
  }, 30_000);
});

describe('the pane socket is behind the one gate (AD-15)', () => {
  it('refuses a socket with no token, a foreign Origin and the wrong Host', async () => {
    const setup = await startPaneServer();
    const pane = await openPane(setup);
    const url = `ws://127.0.0.1:${setup.server.port}/ws/pane/${pane.id}`;
    const refusal = (options: ConstructorParameters<typeof WebSocket>[2], protocols: string[] = []) =>
      new Promise<number>((resolve) => {
        const ws = trackSocket(new WebSocket(url, protocols, options));
        ws.on('error', () => {});
        ws.once('unexpected-response', (_req, res) => resolve(res.statusCode!));
        ws.once('open', () => resolve(101));
      });
    expect(await refusal({ headers: { origin: setup.tab.origin } })).toBe(401);
    expect(await refusal({ headers: { origin: 'http://evil.example' } }, [...setup.tab.protocols])).toBe(403);
    expect(await refusal({ headers: { origin: setup.tab.origin, host: 'evil.example' } }, [...setup.tab.protocols])).toBe(403);
    expect(await refusal({ headers: { origin: setup.tab.origin } }, [...setup.tab.protocols])).toBe(101);
  }, 30_000);

  it('refuses the REST routes without a tab token', async () => {
    const setup = await startPaneServer();
    expect((await fetch(panesUrl(setup))).status).toBe(401);
    expect((await fetch(panesUrl(setup), { method: 'POST', headers: { 'content-type': 'application/json', origin: setup.tab.origin }, body: '{"cols":80,"rows":24}' })).status).toBe(401);
  }, 30_000);
});

describe('a pane runs the shell in the project folder', () => {
  it('opens in the project folder, types and prints, follows the viewer size, and says what it is', async () => {
    const setup = await startPaneServer();
    const pane = await openPane(setup);
    expect(pane).toMatchObject({ launcherId: 'shell', title: 'Terminal 1', workspaceId: setup.wsId, exitCode: null });
    const listed = PanesResponse.parse(await (await fetch(panesUrl(setup), { headers: setup.tab.headers })).json());
    expect(listed.panes.map((p) => p.id)).toEqual([pane.id]);
    expect(listed.terminal).toEqual({ available: true });

    const viewer = viewPane(setup, pane.id, { cols: 91, rows: 27 });
    await viewer.opened;
    await waitFor(() => viewer.state.output.includes('fake-shell-ready'), 'the prompt', 15_000);
    expect(viewer.state.frames.some((f) => f.type === 'state')).toBe(true);
    viewer.type('echo hello pane\r');
    await waitFor(() => viewer.state.output.includes('echo:echohellopane') || viewer.state.output.includes('echo:echo hello pane'), 'the echoed line', 15_000);
    viewer.type('size\r');
    await waitFor(() => viewer.state.output.includes('size=91x27'), 'the size the viewer had', 15_000);
    const record = recordOf(setup);
    // The program started in the project folder (its real path), as the user's own terminal would.
    expect(record.cwd.toLowerCase()).toContain(setup.repo.split(/[\\/]/).pop()!.toLowerCase());
  }, 45_000);

  it('names a second pane Terminal 2 and keeps panes apart per project', async () => {
    const setup = await startPaneServer();
    const first = await openPane(setup);
    const second = await openPane(setup);
    expect([first.title, second.title]).toEqual(['Terminal 1', 'Terminal 2']);
    const other = tempDir('ogden-agents-repo-');
    const { workspace } = WorkspaceResponse.parse(
      await (await fetch(`${setup.server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ path: other }) })).json(),
    );
    const listed = PanesResponse.parse(await (await fetch(`${setup.server.url}${apiPath(API_ROUTES.workspacePanes, { wsId: workspace.id })}`, { headers: setup.tab.headers })).json());
    expect(listed.panes).toEqual([]);
    // Another project's id never reaches this project's pane.
    const wrong = await fetch(`${setup.server.url}${apiPath(API_ROUTES.workspacePane, { wsId: workspace.id, paneId: first.id })}`, { method: 'DELETE', headers: setup.tab.headers });
    expect(wrong.status).toBe(404);
  }, 45_000);

  it('rejects a malformed body and answers a refused pane in plain words', async () => {
    const setup = await startPaneServer();
    const bad = await fetch(panesUrl(setup), { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ cols: 0, rows: 24 }) });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${setup.server.url}${apiPath(API_ROUTES.workspacePanes, { wsId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' })}`, { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ cols: 80, rows: 24 }) });
    expect(missing.status).toBe(404);
  }, 30_000);
});

describe("what the pane's program is given (E16-R2, AD-16)", () => {
  it('gets the allowlist plus COLORTERM, and no secret of the server reaches it or a shell in it', async () => {
    const sentinels: Record<string, string> = {
      ANTHROPIC_API_KEY: 'sk-ant-sentinel-1',
      OPENAI_API_KEY: 'sk-sentinel-2',
      GH_TOKEN: 'ghp_sentinel3',
      NPM_TOKEN: 'npm_sentinel4',
      OGDEN_AGENTS_SECRET_THING: 'sentinel5',
      LC_SNEAKY_TOKEN: 'sentinel6',
      HTTPS_PROXY: 'http://user:sentinel7@proxy.invalid:3128',
      SSH_AUTH_SOCK: '/tmp/sentinel8.sock',
    };
    const before: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(sentinels)) {
      before[name] = process.env[name];
      process.env[name] = value;
    }
    try {
      const setup = await startPaneServer();
      const pane = await openPane(setup);
      const viewer = viewPane(setup, pane.id);
      await viewer.opened;
      await waitFor(() => viewer.state.output.includes('fake-shell-ready'), 'the prompt', 15_000);
      viewer.type('secret\r');
      await waitFor(() => viewer.state.output.includes('secret-done'), 'the secret listing', 15_000);
      const { envNames, colorterm, term } = recordOf(setup);
      for (const name of Object.keys(sentinels)) expect(envNames, name).not.toContain(name);
      expect(envNames).toEqual(expect.arrayContaining(['PATH', 'COLORTERM', 'TERM']));
      expect(colorterm).toBe('truecolor');
      expect(term).toBe('xterm-256color');
      expect(viewer.state.output).not.toContain('secret=');
      for (const value of Object.values(sentinels)) expect(viewer.state.raw).not.toContain(value);
    } finally {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }, 45_000);
});

describe('refresh replays the screen from the server mirror (spike 16.1 finding 12)', () => {
  it('rebuilds a full-screen picture painted once on the alternate screen, which a raw tail could not', async () => {
    const setup = await startPaneServer();
    const pane = await openPane(setup);
    const first = viewPane(setup, pane.id);
    await first.opened;
    await waitFor(() => first.state.output.includes('fake-shell-ready'), 'the prompt', 15_000);
    first.type('alt\r');
    await waitFor(() => first.state.output.includes('screen-row-5'), 'the picture', 15_000);
    // Plenty of output after it, so the paint is far older than any tail.
    first.ws.close();
    const second = viewPane(setup, pane.id);
    await second.opened;
    await waitFor(() => second.state.output.includes('screen-row-3'), 'the replayed screen', 15_000);
    expect(second.state.frames.map((f) => f.type)).toContain('reset');
    // The alternate screen itself is replayed, not only its text.
    expect(second.state.raw).toContain('?1049h');
    for (let row = 1; row <= 5; row += 1) expect(second.state.output).toContain(`screen-row-${row}`);
  }, 45_000);
});

describe('closing and restarting a pane', () => {
  it('stops the program and what it started, and the pane is gone', async () => {
    const setup = await startPaneServer({ shellFlags: ['--grandchild'] });
    const pane = await openPane(setup);
    await waitFor(() => existsSync(setup.record), 'the shell to start', 15_000);
    const { pid, grandchild } = recordOf(setup);
    expect(alive(pid) && alive(grandchild!)).toBe(true);
    const viewer = viewPane(setup, pane.id);
    await viewer.opened;
    const response = await fetch(paneUrl(setup, pane.id), { method: 'DELETE', headers: setup.tab.headers });
    expect(response.status).toBe(204);
    await waitFor(() => !alive(pid) && !alive(grandchild!), 'the pane and its child to stop', 15_000);
    await waitFor(() => viewer.state.closed !== undefined, 'the viewer to be closed', 15_000);
    expect(viewer.state.closed).toBe(PANE_CLOSE.closed);
    const listed = PanesResponse.parse(await (await fetch(panesUrl(setup), { headers: setup.tab.headers })).json());
    expect(listed.panes).toEqual([]);
  }, 45_000);

  it('says exited when the program ends, keeps the pane, and Restart pane starts it again in the same pane', async () => {
    const setup = await startPaneServer();
    const pane = await openPane(setup);
    const viewer = viewPane(setup, pane.id);
    await viewer.opened;
    await waitFor(() => viewer.state.output.includes('fake-shell-ready'), 'the prompt', 15_000);
    viewer.type('exit 3\r');
    await waitFor(() => viewer.state.frames.some((f) => f.type === 'exit' && f.exitCode === 3), 'the exit', 15_000);
    expect(viewer.state.closed).toBeUndefined();
    const stopped = PanesResponse.parse(await (await fetch(panesUrl(setup), { headers: setup.tab.headers })).json()).panes[0]!;
    expect(stopped).toMatchObject({ id: pane.id, state: 'exited', exitCode: 3 });

    const restarted = await fetch(`${paneUrl(setup, pane.id)}/restart`, { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ cols: 100, rows: 30 }) });
    expect(restarted.status).toBe(200);
    expect(PaneResponse.parse(await restarted.json()).pane.id).toBe(pane.id);
    // The same socket gets the new program's screen.
    await waitFor(() => viewer.state.frames.filter((f) => f.type === 'reset').length >= 2 && viewer.state.output.includes('fake-shell-ready'), 'the new prompt', 15_000);
    viewer.type('echo again\r');
    await waitFor(() => /echo:echo\s?again/.test(viewer.state.output), 'the answer', 15_000);
  }, 60_000);
});

describe("what a pane prints is the user's own (AD-6, AD-16)", () => {
  it('appears in no log line, no event and no file of the data folder', async () => {
    const setup = await startPaneServer();
    const pane = await openPane(setup);
    const viewer = viewPane(setup, pane.id);
    await viewer.opened;
    await waitFor(() => viewer.state.output.includes('fake-shell-ready'), 'the prompt', 15_000);
    viewer.type(`echo ${MARKER}\r`);
    await waitFor(() => viewer.state.output.includes(`echo:${MARKER}`) || viewer.state.output.includes(`echo:echo${MARKER}`) || viewer.state.output.includes(MARKER + '\r'), 'the marker', 15_000);
    await waitFor(() => viewer.state.output.includes(`echo:echo ${MARKER}`) || viewer.state.output.includes(`echo:echo${MARKER}`), 'the answer', 15_000);
    expect(setup.lines.join('\n')).not.toContain(MARKER);
    expect(JSON.stringify(setup.server.core.events.readAfter(0))).not.toContain(MARKER);
    const dataDir = setup.server.dataDir;
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));
    for (const file of files(dataDir)) expect(readFileSync(file).includes(MARKER), file).toBe(false);
  }, 45_000);
});
