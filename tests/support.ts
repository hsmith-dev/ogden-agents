/**
 * The root tests' one support module, for the launcher tests (Vitest) and the
 * browser tests (Playwright) alike, so it imports neither runner: the built
 * server (`dist/server.js`, as `pnpm build` writes it) on a temp data folder,
 * the launcher handshake, and connecting and quitting the way the page does.
 * Routes come from the shared `API_ROUTES`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** The second agent's id and product name (epic 6): the fake ACP agent registered again, for tests only. */
export const SECOND_AGENT = { agentId: 'fake-agent', displayName: 'Fake Agent' } as const;

/**
 * The fake ACP agent as a second agent (epic 6, `extraAgents`): its own id and
 * name, Ask and Skip all only (as Antigravity will declare), no terminal, and
 * `FAKE_ACP_AGENT_NAME` set so its `whoami` reply says which agent answered.
 */
export async function fakeSecondAgent(): Promise<NonNullable<NonNullable<StartOptions>['extraAgents']>[number]> {
  const { createClaudeCodeAgent } = await serverModule();
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: SECOND_AGENT.agentId } });
  return {
    // What the fake agent is (6.3): agent-neutral data, as a later agent's adapter exports it.
    descriptor: {
      agentId: SECOND_AGENT.agentId,
      displayName: SECOND_AGENT.displayName,
      provider: 'Fake Provider',
      install: { kind: 'npm', package: '@fake/agent', version: '1.0.0' },
      signInMethods: [{ id: 'fake-login', kind: 'subscription', label: 'Sign in with your account' }],
      permissionModes: { ask: 'default', skip_all: 'bypassPermissions' },
      needsProjectTrust: false,
      skillsFolder: '.fake/skills',
    },
    agent: {
      displayName: SECOND_AGENT.displayName,
      permissionModes: ['ask', 'skip_all'],
      skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
      startSession: (input) => base.startSession(named(input)),
      reopenSession: (input) => base.reopenSession(named(input)),
      listAuthMethods: (input) => base.listAuthMethods(input),
    },
  };
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
