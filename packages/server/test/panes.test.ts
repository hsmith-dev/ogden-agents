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
  PaneLaunchersResponse,
  PaneResponse,
  PanesResponse,
  WorkspaceResponse,
  type Pane,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { addFakeCli, makeFakeCliFolder } from '../../../tests/fixtures/fake-cli-folder.js';
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
      // Windows spells it `Path`: names match without case there.
      expect(envNames.map((name) => name.toUpperCase())).toEqual(expect.arrayContaining(process.platform === 'win32' ? ['PATH', 'COLORTERM'] : ['PATH', 'COLORTERM', 'TERM']));
      expect(colorterm).toBe('truecolor');
      // node-pty names the terminal for a POSIX program; a ConPTY program has no TERM.
      if (process.platform !== 'win32') expect(term).toBe('xterm-256color');
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

describe('the layout over the API (story 16.4)', () => {
  it('splits a pane beside another, resizes and renames through the API, refuses a layout that is not the same panes, and says when the cap is reached', async () => {
    const setup = await startPaneServer();
    const first = await openPane(setup);
    const second = PaneResponse.parse(
      await (await fetch(panesUrl(setup), { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ cols: 80, rows: 24, placement: { kind: 'split', paneId: first.id, direction: 'row' } }) })).json(),
    ).pane;
    const listed = PanesResponse.parse(await (await fetch(panesUrl(setup), { headers: setup.tab.headers })).json());
    expect(listed.layout.tabs).toHaveLength(1);
    expect(listed.layout.tabs[0]!.root).toMatchObject({ type: 'split', first: { paneId: first.id }, second: { paneId: second.id } });

    const tab = listed.layout.tabs[0]!;
    const arranged = { layout: { ...listed.layout, tabs: [{ ...tab, title: 'Two', root: { ...tab.root, ratio: 0.3 } }] } };
    const put = await fetch(`${setup.server.url}${apiPath(API_ROUTES.workspacePaneLayout, { wsId: setup.wsId })}`, { method: 'PUT', headers: jsonHeaders(setup.tab), body: JSON.stringify(arranged) });
    expect(put.status).toBe(200);
    expect(PanesResponse.parse(await put.json()).layout.tabs[0]).toMatchObject({ title: 'Two', root: { ratio: 0.3 } });
    const bad = await fetch(`${setup.server.url}${apiPath(API_ROUTES.workspacePaneLayout, { wsId: setup.wsId })}`, { method: 'PUT', headers: jsonHeaders(setup.tab), body: JSON.stringify({ layout: { tabs: [], activeTabId: null } }) });
    expect(bad.status).toBe(400);

    const renamed = await fetch(paneUrl(setup, first.id), { method: 'PATCH', headers: jsonHeaders(setup.tab), body: JSON.stringify({ title: 'Build' }) });
    expect(PaneResponse.parse(await renamed.json()).pane.title).toBe('Build');
    expect((await fetch(paneUrl(setup, first.id), { method: 'PATCH', headers: jsonHeaders(setup.tab), body: JSON.stringify({ title: '' }) })).status).toBe(400);

    // The cap of 8 per project is refused with its reason.
    for (let i = 0; i < 6; i += 1) await openPane(setup);
    const over = await fetch(panesUrl(setup), { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ cols: 80, rows: 24 }) });
    expect(over.status).toBe(409);
    expect(ApiErrorBody.parse(await over.json()).error).toMatchObject({ code: 'pane_limit_reached', details: { scope: 'project', limit: 8 } });
  }, 90_000);

  it('refuses the layout routes without Developer mode', async () => {
    const setup = await startPaneServer({ developerMode: false });
    const put = await fetch(`${setup.server.url}${apiPath(API_ROUTES.workspacePaneLayout, { wsId: setup.wsId })}`, { method: 'PUT', headers: jsonHeaders(setup.tab), body: JSON.stringify({ layout: { tabs: [], activeTabId: null } }) });
    expect(put.status).toBe(403);
    expect((await fetch(paneUrl(setup, 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3'), { method: 'PATCH', headers: jsonHeaders(setup.tab), body: JSON.stringify({ title: 'x' }) })).status).toBe(403);
  }, 30_000);
});

describe('launchers and install detection over the API (story 16.5)', () => {
  /** A server whose detection sees only a folder of fake programs. */
  async function startWithFakeClis(names: string[]) {
    const folder = makeFakeCliFolder(names);
    dirs.push(folder);
    process.env.OGDEN_AGENTS_TEST_PANE_PATH = folder;
    try {
      const setup = await startPaneServer();
      return { setup, folder };
    } finally {
      delete process.env.OGDEN_AGENTS_TEST_PANE_PATH;
    }
  }
  const launchersUrl = (setup: Setup) => `${setup.server.url}${API_ROUTES.terminalLaunchers}`;
  const states = async (setup: Setup, init: RequestInit = {}) => {
    const response = await fetch(launchersUrl(setup), { headers: setup.tab.headers, ...init });
    expect(response.status).toBe(200);
    const body = PaneLaunchersResponse.parse(await response.json());
    return { body, text: JSON.stringify(body), states: Object.fromEntries(body.launchers.map((one) => [one.launcher.id, one.detection.state])) };
  };

  it('Developer mode only: refused 403 without it', async () => {
    const setup = await startPaneServer({ developerMode: false });
    expect((await fetch(launchersUrl(setup), { headers: setup.tab.headers })).status).toBe(403);
    expect((await fetch(launchersUrl(setup), { method: 'POST', headers: setup.tab.headers })).status).toBe(403);
  }, 30_000);

  it('lists what detection found: the programs in the folder are found, the others not found with their install page, an uninstalled Gemini left out, and no path given out', async () => {
    const { setup, folder } = await startWithFakeClis(['claude', 'codex']);
    const { body, text, states: found } = await states(setup);
    expect(found).toEqual({ shell: 'found', 'claude-code': 'found', codex: 'found', grok: 'not_found', antigravity: 'not_found', copilot: 'not_found' });
    expect(body.launchers.find((one) => one.launcher.id === 'grok')!.launcher.installUrl).toBe('https://x.ai/cli');
    expect(body.launchers.find((one) => one.launcher.id === 'copilot')!.launcher.termsNote).toBe('interactive_only');
    expect(body.launchers.find((one) => one.launcher.id === 'claude-code')!.detection.version).toBe('fake-cli 1.2.3');
    expect(text).not.toContain(folder);
    expect(text).not.toContain(tmpdir());
    // Detect looks again: a program installed since (by the user) is then found; nothing was installed by Ogden.
    addFakeCli(folder, 'grok');
    expect((await states(setup)).states.grok).toBe('not_found');
    expect((await states(setup, { method: 'POST' })).states.grok).toBe('found');
    expect((await states(setup)).states.grok).toBe('found');
    addFakeCli(folder, 'gemini');
    expect((await states(setup, { method: 'POST' })).states.gemini).toBe('found');
  }, 60_000);

  it('a found program starts as a pane with its own arguments and what the user typed, no flag of Ogden\'s, and no secret of the server', async () => {
    const { setup } = await startWithFakeClis(['codex']);
    const sentinel = 'sk-launcher-sentinel';
    process.env.OPENAI_API_KEY = sentinel;
    try {
      const response = await fetch(panesUrl(setup), { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ cols: 90, rows: 28, launcherId: 'codex', args: '--model big "two words"' }) });
      expect(response.status).toBe(201);
      const pane = PaneResponse.parse(await response.json()).pane;
      expect(pane).toMatchObject({ launcherId: 'codex', title: 'Codex 1' });
      const viewer = viewPane(setup, pane.id);
      await viewer.opened;
      await waitFor(() => viewer.state.output.includes('fake-shell-ready'), 'the CLI to start', 20_000);
      viewer.type('args\r');
      await waitFor(() => viewer.state.output.includes('args='), 'its arguments', 15_000);
      expect(viewer.state.output.replace(/\s/g, '')).toContain('args=["--model","big","twowords"]'.replace(/\s/g, ''));
      viewer.type('secret\r');
      await waitFor(() => viewer.state.output.includes('secret-done'), 'the secret listing', 15_000);
      expect(viewer.state.output).not.toContain('secret=');
      expect(viewer.state.raw).not.toContain(sentinel);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 60_000);

  it('refuses a program that is not found with 409 and plain words, opens nothing, and refuses unknown launcher ids and unclosed quotes', async () => {
    const { setup } = await startWithFakeClis(['codex']);
    const post = (body: unknown) => fetch(panesUrl(setup), { method: 'POST', headers: jsonHeaders(setup.tab), body: JSON.stringify({ cols: 80, rows: 24, ...(body as object) }) });
    const missing = await post({ launcherId: 'grok' });
    expect(missing.status).toBe(409);
    expect(ApiErrorBody.parse(await missing.json()).error).toMatchObject({ code: 'launcher_unavailable', message: 'Grok was not found on this computer. Install it yourself, then press Detect.', details: { launcher: 'not_found', installUrl: 'https://x.ai/cli' } });
    expect((await post({ launcherId: 'nope' })).status).toBe(409);
    expect((await post({ launcherId: 'codex', args: '"open' })).status).toBe(400);
    expect((await post({ launcherId: 'codex', args: 'bad\u0007' })).status).toBe(400);
    const listed = PanesResponse.parse(await (await fetch(panesUrl(setup), { headers: setup.tab.headers })).json());
    expect(listed.panes).toEqual([]);
  }, 60_000);
});
