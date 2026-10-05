/**
 * The root tests' one support module, for the launcher tests (Vitest) and the
 * browser tests (Playwright) alike, so it imports neither runner: the built
 * server (`dist/server.js`, as `pnpm build` writes it) on a temp data folder,
 * the launcher handshake, and connecting and quitting the way the page does.
 * Routes come from the shared `API_ROUTES`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The shared routes' own file (it has no imports): the root package depends
// only on the server (AD-1), so it doesn't resolve `@ogden-agents/shared`.
import { API_ROUTES } from '../packages/shared/src/api.ts';
import { writePinnedCopy } from './fixtures/pinned-copy.js';

export { API_ROUTES };

type ServerModule = typeof import('@ogden-agents/server');
/** A started server with its launch link (`startServer` asks for one). */
export type RunningServer = Awaited<ReturnType<ServerModule['start']>> & { launchUrl: string };
export type StartOptions = Parameters<ServerModule['start']>[0];

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const WEB_ROOT = join(ROOT, 'dist', 'web');

/** The built server module, for `start` and its exports (such as `ToolchainError`). */
export async function serverModule(): Promise<ServerModule> {
  return (await import(pathToFileURL(join(ROOT, 'dist', 'server.js')).href)) as ServerModule;
}

/** A fresh temp data folder; the caller removes it with `removeDataDir`. */
export function makeDataDir(prefix = 'ogden-agents-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDataDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/**
 * The server's BMad Method source as a downloaded pinned copy (entry 4.12)
 * of the skill folders in `files` (paths under `.claude/skills/`, as a test
 * writes them into its repo), so the real catalog labels exactly those
 * skills. In memory: nothing downloads. `remove` deletes the copy.
 */
export async function verifiedCopySource(files: Readonly<Record<string, string>>) {
  const dir = makeDataDir('ogden-agents-e2e-pinned-');
  const prefix = '.claude/skills/';
  const copy = writePinnedCopy(dir, Object.fromEntries(Object.entries(files).flatMap(([path, content]) => (path.startsWith(prefix) ? [[path.slice(prefix.length), content]] : []))));
  const skillFiles: Record<string, string> = {};
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length).split('/')[0]!;
    const file = copy.file(`${name}/SKILL.md`);
    if (file !== undefined) skillFiles[`${name}/SKILL.md`] = file;
  }
  const source = (await serverModule()).createMemoryBmadSource({ ready: true, files: skillFiles });
  return { source, remove: () => removeDataDir(dir) };
}

/** The fake ACP agent, which also stands in for the Claude CLI (`--cli`, the fake login program). */
export const FAKE_AGENT = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent.mjs');

/**
 * Starts the built server on `port` (0: any free port) with `dataDir`, logging nowhere, with a launch link.
 * `extra` adds options (a stub toolchain, say). The agent is the fake one unless `extra` names another,
 * so no test runs the real Claude Code adapter or its login. API keys are kept in memory and their
 * check is a stub unless `extra` says otherwise, so no test touches the real keychain or reaches
 * Anthropic (story 9.2).
 *
 * Welcome (story 9.5) is marked done in `dataDir` first, so a tab lands on
 * Projects, unless `firstRun` is set (the Welcome tests).
 *
 * BMad Method's setup (story 4.3) is {@link stubSetupCatalog}'s unless
 * `extra` names a catalog, so turning Planning or Board on never runs uv or
 * reaches the network.
 */
export async function startServer(
  dataDir: string,
  port = 0,
  { firstRun = false, extraAgentEnv, ...extra }: StartOptions & { firstRun?: boolean } = {},
): Promise<RunningServer> {
  const { start, createLogger, createMemorySecretStore } = await serverModule();
  const bmadCatalog = extra.bmadCatalog ?? (await stubSetupCatalog(extra.bmadSource === undefined ? {} : { source: extra.bmadSource }));
  if (!firstRun) writeFileSync(join(dataDir, 'onboarding.json'), `${JSON.stringify({ welcomeCompleted: true })}\n`, { mode: 0o600 });
  // Claude Code (the fake) is signed in unless the test says otherwise (6.3: a signed-out agent refuses a new chat);
  // a first run (the Welcome tests) starts signed out, as a fresh install does.
  const loginState = join(dataDir, 'test-login-state.json');
  if (!firstRun) writeFileSync(loginState, `${JSON.stringify({ loggedIn: true })}\n`);
  return start({
    port,
    open: false,
    dataDir,
    webRoot: WEB_ROOT,
    log: createLogger(() => {}),
    claudeAdapterPath: FAKE_AGENT,
    secrets: createMemorySecretStore(),
    verifyApiKey: async () => 'ok',
    // Antigravity only where a test wires it (`fakeAntigravity`, epic 6 entry 5): the other tests see the agents they name.
    antigravity: false,
    // Codex likewise (epic 12): only where a test wires it.
    codex: false,
    // The "newer version" check (story 13.7) never reaches npm from a test: a test that wants it passes a fake registry.
    updates: false,
    // Codex likewise (epic 12): only where a test wires it (`fixtureCodex`).
    codex: false,
    extraAgentEnv: { FAKE_LOGIN_STATE: loginState, ...extraAgentEnv },
    ...extra,
    bmadCatalog,
    launch: true,
  });
}

type BmadCatalog = NonNullable<NonNullable<StartOptions>['bmadCatalog']>;

/** The setup steps as `BMAD_SETUP_STEP_LABELS` names them (`planning.ts` has imports this module can't load). */
const SETUP_STEPS = [
  ['checking', 'Checking the project'],
  ['copying_skills', 'Copying the BMad Method skills'],
  ['writing_config', "Writing the project's BMad Method settings"],
  ['verifying', 'Checking the setup'],
] as const;

/**
 * The real read-only BMad Method catalog (detection, skills, catalog) with
 * a stub setup (story 4.3): it first downloads through `source` when given
 * (the server's one BMad Method source, as the real setup does: review S1;
 * its catalog labels only the skills that are that source's verified copy's,
 * entry 4.12),
 * then reports each step `stepMs` apart, then the project counts as set up in
 * memory, or the setup fails with `fail` (an error whose own text names a
 * path, which the UI must never show). Nothing is written and no uv runs; the
 * server tests run the real `setup.py`. Its repos lack no capability (entry
 * 4.11: as after a setup), so the board is never in reduced mode here; the
 * reduced-mode browser test uses the memory catalog.
 */
export async function stubSetupCatalog({
  fail = false,
  stepMs = 150,
  source,
}: { fail?: boolean; stepMs?: number; source?: Pick<NonNullable<NonNullable<StartOptions>['bmadSource']>, 'download' | 'file'> } = {}): Promise<BmadCatalog> {
  const { createBmadCatalog } = await serverModule();
  // Labels only for skills that are the source's verified copy's (entry 4.12); none without a source.
  const real = createBmadCatalog(source === undefined ? undefined : { source });
  const done = new Set<string>();
  const status = (setUp: boolean) => ({
    state: setUp ? ('current' as const) : ('not_set_up' as const),
    outputFolder: setUp ? '_bmad-output' : null,
    bundledVersion: '7.0.0',
    installedVersion: setUp ? '7.0.0' : null,
    problems: [],
  });
  const hasBmad = async (repoPath: string) => done.has(repoPath) || (await real.detect(repoPath)).hasBmad;
  return {
    ...real,
    detect: async (repoPath) => ({ ...(await real.detect(repoPath)), hasBmad: await hasBmad(repoPath) }),
    setupStatus: async (repoPath) => status(await hasBmad(repoPath)),
    missingCapabilities: async () => [],
    setup: async (repoPath, onProgress) => {
      if (source !== undefined) await source.download();
      for (const [step, label] of SETUP_STEPS) {
        onProgress({ step, label });
        await new Promise((resolve) => setTimeout(resolve, stepMs));
      }
      if (fail) throw new Error(`EACCES: permission denied, mkdir '${repoPath}/_bmad'`);
      done.add(repoPath);
      return status(true);
    },
  };
}

/** How a test registers an agent (`StartOptions.extraAgents`, 6.3). */
type AgentWiringOf = NonNullable<NonNullable<StartOptions>['extraAgents']>[number];

/** The second agent's id and product name (epic 6): the fake ACP agent registered again, for tests only. */
export const SECOND_AGENT = { agentId: 'fake-agent', displayName: 'Fake Agent' } as const;

/**
 * The fake ACP agent as a second agent (epic 6, `extraAgents`): its own id and
 * name, Ask and Skip all only (as Antigravity will declare), no terminal, and
 * `FAKE_ACP_AGENT_NAME` set so its `whoami` reply says which agent answered.
 */
export async function fakeSecondAgent(
  options: { setup?: AgentWiringOf['setup']; needsProjectTrust?: boolean; agentId?: string; displayName?: string } = {},
): Promise<AgentWiringOf> {
  const { createClaudeCodeAgent } = await serverModule();
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const agentId = options.agentId ?? SECOND_AGENT.agentId;
  const displayName = options.displayName ?? SECOND_AGENT.displayName;
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: agentId } });
  return {
    // What the fake agent is (6.3): agent-neutral data, as a later agent's adapter exports it.
    descriptor: {
      agentId,
      displayName,
      provider: 'Fake Provider',
      install: { kind: 'npm', package: '@fake/agent', version: '1.0.0' },
      signInMethods: [{ id: 'fake-login', kind: 'subscription', label: 'Sign in with your account' }],
      permissionModes: { ask: 'default', skip_all: 'bypassPermissions' },
      needsProjectTrust: options.needsProjectTrust ?? false,
      skillsFolder: '.fake/skills',
    },
    // Its setup port (6.3), when a test gives one: then a new chat with it is refused while it isn't installed or signed in.
    ...(options.setup === undefined ? {} : { setup: options.setup }),
    agent: {
      displayName,
      permissionModes: ['ask', 'skip_all'],
      skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
      startSession: (input) => base.startSession(named(input)),
      reopenSession: (input) => base.reopenSession(named(input)),
      listAuthMethods: (input) => base.listAuthMethods(input),
    },
  };
}

/**
 * A generic agent that takes its permission mode only when a chat starts and
 * needs the project trusted (epic 12, 12.3), built as a later agent's adapter
 * is: a descriptor and quirks on the shared ACP client, the fake ACP agent
 * (`FAKE_ACP_FIXED_MODE`) as its process. Its mode reaches it in `_meta`
 * (`mode`), and it runs the project's `.mcp.json`, so the trust binds it.
 */
export async function fakeFixedModeAgent(options: { agentId?: string; displayName?: string; needsProjectTrust?: boolean } = {}): Promise<AgentWiringOf> {
  const { createAcpAgent, slashSkillInvocation } = await serverModule();
  const agentId = options.agentId ?? 'fixed-agent';
  const displayName = options.displayName ?? 'Fixed Agent';
  const descriptor = {
    agentId,
    displayName,
    provider: 'Fake Provider',
    install: { kind: 'npm' as const, package: '@fake/fixed-agent', version: '1.0.0' },
    signInMethods: [{ id: 'fake-login', kind: 'subscription' as const, label: 'Sign in with your account' }],
    permissionModes: { ask: 'ask', auto: 'auto', skip_all: 'skip_all' },
    needsProjectTrust: options.needsProjectTrust ?? true,
    projectFiles: ['.mcp.json'],
    modeFixedAtStart: true,
    skillsFolder: '.fixed/skills',
  };
  const agent = createAcpAgent(descriptor, {
    launch: () => ({ command: process.execPath, args: [FAKE_AGENT], addEnv: { FAKE_ACP_FIXED_MODE: '1', FAKE_ACP_AGENT_NAME: agentId } }),
    toolInputPaths: { pathFields: [], patternFields: [] },
    askingModeIds: [],
    skillInvocation: slashSkillInvocation,
    startOptions: ({ permissionMode, protectedPaths }) => ({ meta: { mode: permissionMode }, guardsPaths: protectedPaths !== undefined }),
  });
  return { descriptor, agent };
}

/** The fake ACP agent as Codex's `codex-acp` adapter (`fake-codex.mjs`, epic 12 entry 4). */
export const FAKE_CODEX = join(ROOT, 'tests', 'fixtures', 'fake-codex.mjs');

/** The fake ACP agent as Antigravity's server (`fake-antigravity.mjs`, epic 6 entry 5). */
export const FAKE_ANTIGRAVITY = join(ROOT, 'tests', 'fixtures', 'fake-antigravity.mjs');

/** A Gemini API key's shape (`AIza` and 35 more), for tests; never a real key. */
export const FAKE_GEMINI_KEY = `AIza${'F'.repeat(31)}fake`;

/**
 * Antigravity's own adapters (`StartOptions.antigravity`, epic 6 entry 5)
 * on a folder of their own (`dataDir`, which the caller removes), with the
 * fake agent's Antigravity personality in place of its server. Its setup
 * port is the real one, reading a pinned server planted for this platform
 * (unless `installed: false`), so a chat needs a Gemini API key, as an
 * install without Google sign-in does; or `setup` given in its place.
 */
export async function fakeAntigravity(options: { installed?: boolean; setup?: Awaited<ReturnType<typeof fakeAgentSetup>> } = {}) {
  const { createAntigravityAgent, createAntigravitySetup } = await serverModule();
  const dataDir = makeDataDir('ogden-agents-agy-');
  if (options.installed !== false) plantPinnedAntigravity(dataDir);
  const agent = createAntigravityAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_ANTIGRAVITY, '--uid='] }) });
  // The key check never reaches Google in a test.
  return { dataDir, agent, setup: options.setup ?? createAntigravitySetup({ dataDir, apiKey: { verify: async () => 'ok' } }) };
}

/**
 * Empty files where Antigravity's pinned files for this platform are looked
 * for, and the install record Install writes once it checked them (epic 6
 * entry 7), so it reads as installed (the files are never run: the fake is).
 */
export function plantPinnedAntigravity(dataDir: string): void {
  const pins = JSON.parse(readFileSync(join(ROOT, 'packages', 'adapters', 'src', 'setup-antigravity', 'pins', 'antigravity-acp.json'), 'utf8')) as {
    version: string;
    archives: Record<string, { binary: string; files: Record<string, unknown> } | undefined>;
  };
  const platform = `${process.platform}-${process.arch}`;
  const pin = pins.archives[platform];
  if (pin === undefined) return;
  const folder = join(dataDir, 'agents', 'antigravity', pins.version);
  mkdirSync(folder, { recursive: true });
  for (const name of Object.keys(pin.files)) writeFileSync(join(folder, name), '');
  const files = Object.fromEntries(Object.keys(pin.files).map((name) => [name, 0]));
  writeFileSync(join(folder, '.ogden-install.json'), JSON.stringify({ version: pins.version, platform, reportedVersion: pins.version, files }));
}

/** An in-memory setup port for a fake agent (entry 6: readiness in the picker, Welcome's choice); it installs and signs into nothing. */
export async function fakeAgentSetup(options: { agentId: string; displayName: string; installed?: boolean; auth?: 'signed_in' | 'needs_sign_in'; userCode?: string }) {
  const { createMemoryAgentSetup } = await serverModule();
  return createMemoryAgentSetup(options);
}

// Shared with the plain-Node install scripts: whether a process with a pid
// exists, and the running server's port file (`server.json`) in a data folder.
export { isAlive, readPortFile } from '../scripts/installed-package.mjs';

/** Polls `predicate` until it holds, or throws after `timeoutMs`. */
export async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The launcher token the running server wrote to `launcher.token` in `dataDir`. */
export function readLauncherToken(dataDir: string): string {
  return readFileSync(join(dataDir, 'launcher.token'), 'utf8').trim();
}

/**
 * A fresh single-use launch link from the server at `url` whose data folder
 * is `dataDir`, through the launcher handshake with its launcher token,
 * exactly as `npx ogden-agents` asks for one.
 */
export async function launchLink(url: string, dataDir: string): Promise<string> {
  const token = readLauncherToken(dataDir);
  const response = await fetch(`${url}/launcher/hello?launch=1`, { headers: { 'x-ogden-launcher-token': token } });
  if (!response.ok) throw new Error(`the launcher handshake returned ${response.status}`);
  return ((await response.json()) as { launchUrl: string }).launchUrl;
}

/** The launch code in a launch link (`<origin>/#c=<code>`). */
export function codeOfLink(launchUrl: string): string {
  const match = /^#c=([A-Za-z0-9_-]{43})$/.exec(new URL(launchUrl).hash);
  if (match === null) throw new Error(`not a launch link: ${launchUrl.replace(/#.*/, '#…')}`);
  return match[1]!;
}

/** POSTs a launch code to the exchange as the page's boot script does, with the page's Origin. */
export function postCode(origin: string, code: string): Promise<Response> {
  return fetch(`${origin}${API_ROUTES.tabExchange}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

/**
 * Opens a launch link as the page's boot script does and returns the tab's
 * token, from the response body (never a URL). Throws unless the exchange
 * answered 200 with a token and set no cookie.
 */
export async function exchange(launchUrl: string): Promise<string> {
  const response = await postCode(new URL(launchUrl).origin, codeOfLink(launchUrl));
  if (response.status !== 200) throw new Error(`the code exchange returned ${response.status}, not 200`);
  if (response.headers.get('set-cookie') !== null) throw new Error('the code exchange set a cookie');
  const { token } = (await response.json()) as { token?: unknown };
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('the code exchange returned no token');
  return token;
}

/** Quit, as the UI does it (the tab's token and the page's Origin); resolves with the reply. */
export function requestQuit(url: string, token: string): Promise<Response> {
  return fetch(`${url}${API_ROUTES.serverQuit}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: url } });
}
