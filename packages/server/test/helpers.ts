/**
 * The server tests' one support module: temp folders, a tiny built UI,
 * starting a real server that is closed after the test, raw HTTP requests,
 * and connecting a tab the way the page does (AD-15 as amended in story 2.1).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryAgentSetup, createMemoryAppShortcut, createMemoryBmadCatalog, createMemoryBmadSource, createMemorySecretStore, createMemoryTicketStore } from '@ogden-agents/adapters';
import { createAgentRegistry, createAgentSetup, createBmadSource, createBoard, createChat, createNewProjectDefaults, createOnboarding, createPlanning, type AgentDescriptor, type AgentPort, type Core, type RegisteredAgent } from '@ogden-agents/core';
import { API_ROUTES, webSocketProtocols } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { afterEach } from 'vitest';
import { fixtureSource, TEST_PYTHON } from '../../../tests/fixtures/bmad-upstream-source.js';
import type WebSocket from 'ws';
import { createApp, type AppOptions } from '../src/app.js';
import { createLaunchCodes, createTabTokens } from '../src/auth.js';
import { createGate } from '../src/gate.js';
import { createLogger } from '../src/log.js';
import { start, type RunningServer, type StartOptions } from '../src/start.js';

const dirs: string[] = [];
const servers: RunningServer[] = [];
const sockets: WebSocket[] = [];

// Registered before any test file's own afterEach hooks, so it runs after them
// (hooks run in reverse order). In order: sockets, then servers, then the
// folders they used.
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  // close() is safe to call again on a server a test already closed.
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/**
 * Removes `dir` after the test, once its servers (and the agents they ran
 * there) are closed; Windows refuses to delete a folder a process still uses.
 */
export function removeAfterTest(dir: string): string {
  dirs.push(dir);
  return dir;
}

/** A fresh temp data folder, removed after the test. */
export function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-server-'));
  dirs.push(dir);
  return dir;
}

/** Terminates `ws` after the test, if it is still open. Returns it. */
export function trackSocket<T extends WebSocket>(ws: T): T {
  sockets.push(ws);
  return ws;
}

/** A tiny built UI (`index.html` and `assets/app.js`), so tests don't depend on `packages/web` being built. */
export function tinyWebRoot(): string {
  const dir = join(tempDataDir(), 'web');
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app")');
  return dir;
}

/** A clock the test moves by hand. */
export function manualClock() {
  let t = Date.now();
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** Polls `predicate` until it holds, or throws after `timeoutMs`. */
export async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * A test agent's descriptor (6.3): sound, named and moded as `agent` is, with
 * a subscription sign-in and an API key in `FAKE_AGENT_KEY`; `overrides` change any field.
 */
export function testDescriptor(agentId: string, agent: Pick<AgentPort, 'displayName' | 'permissionModes'>, overrides: Partial<AgentDescriptor> = {}): AgentDescriptor {
  const declared = agent.permissionModes ?? ['ask'];
  return {
    agentId,
    displayName: agent.displayName,
    provider: 'Fake Provider',
    install: { kind: 'npm', package: '@fake/agent', version: '1.0.0' },
    signInMethods: [
      { id: 'fake-login', kind: 'subscription', label: 'Sign in with your account' },
      { id: 'fake-key', kind: 'api_key', label: 'Use an API key', apiKey: { envNames: ['FAKE_AGENT_KEY'], format: 'Starts with fake-' } },
    ],
    permissionModes: {
      ask: 'default',
      ...(declared.includes('auto') ? { auto: 'auto' } : {}),
      ...(declared.includes('skip_all') ? { skip_all: 'bypassPermissions' } : {}),
    },
    needsProjectTrust: false,
    skillsFolder: '.fake/skills',
    ...overrides,
  };
}

/** `agent` registered as `agentId`, with {@link testDescriptor}. */
export function registered(agentId: string, agent: AgentPort, overrides: Partial<AgentDescriptor> = {}): RegisteredAgent {
  return { descriptor: testDescriptor(agentId, agent, overrides), agent };
}

/** A started test server; it has a launch link, since tests start it with `launch: true`. */
export type TestServer = RunningServer & { launchUrl: string };

/** The fake ACP agent (`tests/fixtures/fake-acp-agent.mjs`), which also stands in for the Claude CLI (`--cli`). */
export const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

/**
 * Starts a real server on any free port, a temp data folder and a tiny UI,
 * with a launch link, and closes it after the test. Log lines go to `lines`
 * (if given); any start option overrides these defaults. The agent is the
 * fake one, so no test ever runs the real Claude Code adapter or its login;
 * API keys are kept in memory and their check is a stub, so no test touches
 * the real keychain or reaches Anthropic (story 9.2).
 */
export async function startTestServer(options: StartOptions & { lines?: string[] } = {}): Promise<TestServer> {
  const { lines, extraAgentEnv, ...rest } = options;
  const server = await start({
    port: 0,
    open: false,
    log: createLogger((line) => lines?.push(line)),
    dataDir: tempDataDir(),
    webRoot: tinyWebRoot(),
    claudeAdapterPath: FAKE_AGENT,
    secrets: createMemorySecretStore(),
    verifyApiKey: async () => 'ok',
    // The pinned BMad Method as already downloaded (story 4.14), so no test reaches GitHub; a test of the
    // download itself passes its own source, or `bmadFetch` for the real adapter.
    ...(rest.bmadSource === undefined && rest.bmadFetch === undefined ? { bmadSource: createMemoryBmadSource({ ready: true }) } : {}),
    // Claude Code (the fake) is signed in unless the test says otherwise (6.3: a signed-out agent refuses a new chat).
    // Antigravity only where a test wires it (`fakeAntigravity`, epic 6 entry 5): the other tests see the agents they name.
    antigravity: false,
    // Codex likewise (epic 12): only where a test wires it.
    codex: false,
    extraAgentEnv: { FAKE_LOGIN_STATE: signedInLoginState(), ...extraAgentEnv },
    ...rest,
    launch: true,
  });
  servers.push(server);
  return server;
}

/**
 * A fake login state file that says signed in (`FAKE_LOGIN_STATE`, read by
 * the fake CLI's `auth status`), in a temp folder removed after the test.
 */
export function signedInLoginState(): string {
  const file = join(tempDataDir(), 'login-state.json');
  writeFileSync(file, `${JSON.stringify({ loggedIn: true })}\n`);
  return file;
}

/** Closes `server` after the test (for one started some other way). Returns it. */
export function trackServer<T extends RunningServer>(server: T): T {
  servers.push(server);
  return server;
}

export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  json: () => unknown;
}

/**
 * A raw HTTP request to `server`, so `Host` and `Origin` can be anything a
 * hostile client sends (`Host` defaults to the server's own). No kept-alive
 * socket is reused, so it works across a restart on the same port.
 */
export function send(
  server: { port: number },
  path: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const length: Record<string, string> = body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) };
    const req = request(
      { host: '127.0.0.1', port: server.port, path, method, agent: false, headers: { host: `127.0.0.1:${server.port}`, ...length, ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text, json: () => JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** What a connected tab sends: its token and the page's own origin. */
export interface SignedIn {
  token: string;
  origin: string;
  /** `Authorization: Bearer <token>` and `Origin`, for REST calls. */
  headers: Record<string, string>;
  /** The subprotocols a tab offers on `/ws`. */
  protocols: [string, string];
}

/** What a tab holding `token` sends to the server at `origin`. */
export function tabOf(token: string, origin: string): SignedIn {
  return {
    token,
    origin,
    headers: { authorization: `Bearer ${token}`, origin },
    protocols: webSocketProtocols(token),
  };
}

/** The launch code in a launch link (`<origin>/#c=<code>`). */
export function codeOfLink(launchUrl: string): string {
  const match = /^#c=([A-Za-z0-9_-]{43})$/.exec(new URL(launchUrl).hash);
  if (match === null) throw new Error(`not a launch link: ${launchUrl.replace(/#.*/, '#…')}`);
  return match[1]!;
}

/**
 * Opens a launch link as the page's boot script does: POSTs its code to
 * `/api/v1/tab/exchange` with the page's Origin and returns the tab token
 * from the response body. Checks that no cookie was set.
 */
export async function exchange(launchUrl: string): Promise<string> {
  const { origin } = new URL(launchUrl);
  const response = await fetch(`${origin}${API_ROUTES.tabExchange}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ code: codeOfLink(launchUrl) }),
  });
  if (response.status !== 200) throw new Error(`the code exchange returned ${response.status}, not 200`);
  if (response.headers.get('set-cookie') !== null) throw new Error('the code exchange set a cookie');
  const { token } = (await response.json()) as { token?: unknown };
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('the code exchange returned no token');
  return token;
}

/** A new tab connected through `launchUrl`: by default the server's start-up link, which only one tab can spend. */
export async function connectTab(server: { url: string; launchUrl: string }, launchUrl = server.launchUrl): Promise<SignedIn> {
  return tabOf(await exchange(launchUrl), server.url);
}

const signedIn = new WeakMap<object, Promise<SignedIn>>();

/**
 * The server's first tab, connected through its start-up launch link. Cached
 * per server, since that code can be spent only once.
 */
export function signIn(server: { url: string; launchUrl: string }): Promise<SignedIn> {
  let pending = signedIn.get(server);
  if (pending === undefined) {
    pending = connectTab(server);
    signedIn.set(server, pending);
  }
  return pending;
}

/**
 * The server app with every option set, so every route it can have is
 * registered (the gate's route list, story 2.3; 10.6's guard-coverage
 * test): control, toolchain, a chat whose agent always refuses, core's
 * permissions and BMad pieces, the memory agent setup and shortcut,
 * onboarding, tab tokens, the script trust (story 4.2), and Plan and Board on stubs (story 4.1). `extra` adds or overrides options, such as
 * `bmadProbe: true`. Nothing is listened on and no agent ever runs.
 */
export function fullTestApp(core: Core, extra: Partial<AppOptions> = {}): Hono {
  const log = createLogger(() => {});
  const gate = createGate({ port: () => 1, codes: createLaunchCodes(), tabs: createTabTokens(), log });
  const control = {
    info: () => ({ version: '0', pid: 1, port: 1, busySessions: 0 }),
    issueLaunchUrl: () => '',
    restartWhenIdle: () => ({ restarting: false, busySessions: 0 }),
    quit: () => ({ stopping: false, busySessions: 0 }),
  };
  const toolchain = {
    status: async () => ({ state: 'missing' as const }),
    installUv: async () => ({ started: false, uv: { state: 'missing' as const } }),
    settled: async () => {},
  };
  const agent: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    startSession: () => Promise.reject(new Error('no agent in this test')),
    reopenSession: () => Promise.reject(new Error('no agent in this test')),
    listAuthMethods: () => Promise.reject(new Error('no agent in this test')),
  };
  const chat = createChat({
    dataDir: tempDataDir(),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: createAgentRegistry([registered('test-agent', agent)]),
    events: core.events,
    installSettings: core.installSettings,
  });
  const bmadSource = createBmadSource(createMemoryBmadSource({ ready: true }));
  return createApp({
    events: core.events,
    webRoot: tinyWebRoot(),
    log,
    gate,
    control,
    toolchain,
    chat,
    permissions: core.permissions,
    bmad: core.bmad,
    bmadDetection: core.bmadDetection,
    bmadScriptTrust: core.bmadScriptTrust,
    planning: createPlanning({ bmad: core.bmad, entities: core.entities, catalog: createMemoryBmadCatalog(), chat, agent }),
    board: createBoard({ bmad: core.bmad, trust: core.bmadScriptTrust, source: bmadSource, entities: core.entities, catalog: createMemoryBmadCatalog(), tickets: createMemoryTicketStore() }),
    bmadSource,
    agentSetup: createAgentSetup(core.events, [createMemoryAgentSetup()]),
    onboarding: createOnboarding({ dataDir: tempDataDir(), hasProjects: () => false }),
    newProjectDefaults: createNewProjectDefaults({ dataDir: tempDataDir(), bmad: core.bmad }),
    installSettings: core.installSettings,
    appShortcut: createMemoryAppShortcut(),
    tabs: createTabTokens(),
    ...extra,
  });
}

export { FIXTURE_COMMIT, hasManagedPython, realUvMissing, TEST_PYTHON, UPSTREAM_FIXTURE } from '../../../tests/fixtures/bmad-upstream-source.js';

export const TEST_UV_PYTHON_ENV: Readonly<Record<string, string>> = {
  UV_PYTHON: TEST_PYTHON,
  UV_PYTHON_PREFERENCE: 'only-managed',
  UV_PYTHON_DOWNLOADS: 'never',
  // Where `uv python install` put it: setup-uv sets this in CI, and the server's uv allowlist doesn't carry it.
  ...(process.env.UV_PYTHON_INSTALL_DIR ? { UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR } : {}),
};

/**
 * The fixture as codeload would serve it, a lock that pins its content hash,
 * and a `fetch` that answers the tarball and counts its calls: the real
 * `bmad-source` adapter, without the network (story 4.14).
 */
export function fixtureUpstream() {
  const { tarball, lock } = fixtureSource();
  const fetched: string[] = [];
  const fetch = async (url: string) => {
    fetched.push(url);
    return new Response(tarball);
  };
  return { lock, fetch, fetched, tarball };
}
