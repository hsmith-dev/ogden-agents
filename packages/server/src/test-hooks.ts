/**
 * Environment hooks for tests that run the packaged server as its own
 * process (the launcher tests, the installed-package smoke and suite), where
 * `start()`'s options can't be passed. Every hook is honoured only when
 * {@link testHooksAllowed}: a test runner (`NODE_ENV=test`, or `VITEST` set)
 * AND a data folder inside the OS temp folder (compared by real path), as
 * every test's is and no user's is; and only when its own variable is set.
 * For anyone else they do nothing, and Install, the key check and the
 * keychain behave as shipped.
 *
 * - {@link SECRET_STORE_ENV} = `memory`: API keys in memory.
 * - {@link CHECK_IN_MS_ENV}: a shorter quiet-agent check-in delay.
 * - {@link CLAUDE_INSTALL_ENV}: Install takes its pins (and npm) from a JSON
 *   file inside the temp folder instead of the shipped ones. Every locked
 *   package must be a local `file:` fixture with a `sha512-` integrity, so
 *   it never fetches anything and npm still checks it (`npm ci`).
 * - {@link API_KEY_CHECK_ENV} = `accept`: Claude Code's API key check
 *   answers `ok` without reaching Anthropic.
 * - {@link CLAUDE_CLI_ENV}: a Node script inside the temp folder becomes the
 *   agents' `CLAUDE_CODE_EXECUTABLE` (story 3.10), so the installed-package
 *   suite's terminal runs the fake CLI on every OS (Windows takes only a real
 *   `claude.exe` from `PATH`). It is narrower than `OGDEN_AGENTS_CLAUDE_ACP_PATH`,
 *   which already picks the agent's script for anyone.
 * - {@link BMAD_PROBE_ENV} = `1`: registers the test-only route that serves
 *   the `planning` BMad piece behind core's guard (story 10.1), so a test can
 *   see `feature_off` while the piece is off.
 * - {@link BMAD_AVAILABLE_ENV}: a comma list of BMad pieces this install
 *   reports as available on top of the shipped ones (story 10.2), so the
 *   packaged suite can turn on a piece no epic ships yet.
 * - {@link BMAD_SOURCE_ENV}: the server's one BMad Method source pins a
 *   fixture lock and reads its tarball from a local file inside the temp
 *   folder instead of downloading upstream's (story 4.13), and uv children
 *   get a few allowlisted `UV_*` and proxy variables (the test's uv cache, the
 *   provisioned Python, no Python download), so the installed-package suite
 *   sets BMad Method up with no network. The tarball is still checked
 *   against the lock's content hash before anything is saved.
 * - {@link ANTIGRAVITY_SERVER_ENV}: a Node script inside the temp folder
 *   plays Antigravity's ACP server (epic 6 entry 8), so the installed-package
 *   suite can chat with Antigravity through the fake agent on every OS (the
 *   pinned server is never run in a test).
 * - {@link ANTIGRAVITY_INSTALL_ENV} (with {@link ANTIGRAVITY_SERVER_ENV}):
 *   Antigravity's setup takes its pins from a JSON file inside the temp
 *   folder (epic 6 entry 10), so the installed-package suite installs and
 *   uninstalls it from a local fixture archive, checked against its pinned
 *   SHA-256 as shipped; every archive URL must be `http://127.0.0.1`, so it
 *   never reaches the network, and the installed server is the fake. Pins
 *   with no archive for this computer show the unsupported message.
 * - {@link TRUST_AGENT_ENV}: a Node script inside the temp folder (the fake
 *   ACP agent) is registered as one more agent, "Fake Agent", that needs a
 *   trusted project (epic 6 entry 10), so the suite proves core's agent
 *   trust gate on the installed package.
 * - {@link SANDBOX_ENV} = `available`, `unavailable` or `unavailable-windows`: unattended builds
 *   take this answer instead of probing Claude Code's native sandbox (story
 *   5.2: CI's ubuntu runners have no working bwrap, spike 5.1), so the suites
 *   can build with the fake agent, or see `sandbox_unavailable`, on any OS.
 *
 * - {@link CODEX_SERVER_ENV}: a Node script inside the temp folder plays
 *   Codex's `codex-acp` adapter (epic 12 entry 5), so a suite can chat with
 *   Codex through the fake agent's Codex personality on every OS (the pinned
 *   adapter and the real Codex are never run in a test). It also registers
 *   Codex in a shipped-style server, which otherwise leaves it out.
 *
 * - {@link GROK_SERVER_ENV}: a Node script inside the temp folder plays
 *   Grok's `grok agent stdio` (epic 12 entry 7), so a suite can chat with Grok
 *   through the fake agent's Grok personality (the real Grok is never run in a
 *   test). It also registers Grok in a shipped-style server, which otherwise leaves it out.
 *
 * - {@link CODEX_INSTALL_ENV}: Codex's Install takes its pins (and npm) from a
 *   JSON file inside the temp folder, as {@link CLAUDE_INSTALL_ENV} does for
 *   Claude Code, so a suite can install Codex from a local fixture lock.
 *
 * {@link resolveTestHooks} reads them all for `start()`, and
 * {@link testHooksLogFields} is its "test hooks in use" line. Every
 * `OGDEN_AGENTS_TEST_*` name is declared here and read only beside a
 * {@link testHooksAllowed} call (`test/test-hooks-audit.test.ts`).
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative } from 'node:path';
import type { AdapterPins, AntigravityPins } from '@ogden-agents/adapters';
import { clampCheckInDelay, type ApiKeyVerification, type SandboxCheck } from '@ogden-agents/core';
import { BmadLock, BmadPiece, type BmadPiece as BmadPieceName } from '@ogden-agents/shared';
import type { StartOptions } from './start-types.js';

type Env = Readonly<Record<string, string | undefined>>;

/** Path to a JSON file `{ "pins": { "packageJson", "lock" }, "npmCli"?: "<abs>/npm-cli.js" }` (tests only). */
export const CLAUDE_INSTALL_ENV = 'OGDEN_AGENTS_TEST_CLAUDE_INSTALL';
/** `accept`: the API key check answers `ok` without the network (tests only). */
export const API_KEY_CHECK_ENV = 'OGDEN_AGENTS_TEST_API_KEY_CHECK';

/** Absolute path to a `claude` stand-in inside the temp folder, run as the agents' `CLAUDE_CODE_EXECUTABLE` (tests only). */
export const CLAUDE_CLI_ENV = 'OGDEN_AGENTS_TEST_CLAUDE_CLI';

/** `1`: register `TEST_ROUTES.bmadProbe`, a route guarded by the `planning` piece (tests only; story 10.1). */
export const BMAD_PROBE_ENV = 'OGDEN_AGENTS_TEST_BMAD_PROBE';

/** A comma list of BMad pieces to report as available, such as `planning,board` (tests only; story 10.2). */
export const BMAD_AVAILABLE_ENV = 'OGDEN_AGENTS_TEST_BMAD_AVAILABLE';

/** Path to a JSON file `{ "lock": BmadLock, "tarball": "<abs>.tar.gz", "uvEnv"?: { … } }` inside the temp folder (tests only; story 4.13). */
export const BMAD_SOURCE_ENV = 'OGDEN_AGENTS_TEST_BMAD_SOURCE';

/** The only variables {@link BMAD_SOURCE_ENV}'s `uvEnv` may add to uv children; any other name is dropped. */
export const BMAD_SOURCE_UV_ENV_NAMES: readonly string[] = [
  'UV_CACHE_DIR',
  'UV_PYTHON',
  'UV_PYTHON_PREFERENCE',
  'UV_PYTHON_DOWNLOADS',
  'UV_PYTHON_INSTALL_DIR',
  'UV_OFFLINE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
];

/** Absolute path to a Node script inside the temp folder, run under Node as Antigravity's ACP server (tests only; epic 6 entry 8). */
export const ANTIGRAVITY_SERVER_ENV = 'OGDEN_AGENTS_TEST_ANTIGRAVITY_SERVER';
/** Absolute path to a JSON file `{ "pins": AntigravityPins }` inside the temp folder, every archive on `http://127.0.0.1` (tests only; epic 6 entry 10). */
export const ANTIGRAVITY_INSTALL_ENV = 'OGDEN_AGENTS_TEST_ANTIGRAVITY_INSTALL';
/** Path to a JSON file `{ "pins": { "packageJson", "lock" }, "npmCli"?: "<abs>/npm-cli.js" }` for Codex's install, local `file:` fixtures only (tests only; epic 12 entry 6). */
export const CODEX_INSTALL_ENV = 'OGDEN_AGENTS_TEST_CODEX_INSTALL';
/** Absolute path to a Node script inside the temp folder, run under Node in place of Grok's checked binary (tests only; epic 12 entry 7). */
export const GROK_SERVER_ENV = 'OGDEN_AGENTS_TEST_GROK_SERVER';
/** Absolute path to a Node script inside the temp folder, run under Node as Codex's `codex-acp` adapter (tests only; epic 12 entry 5). */
export const CODEX_SERVER_ENV = 'OGDEN_AGENTS_TEST_CODEX_SERVER';
/** Absolute path to a Node script inside the temp folder, registered as a test agent that needs a trusted project (tests only; epic 6 entry 10). */
export const TRUST_AGENT_ENV = 'OGDEN_AGENTS_TEST_TRUST_AGENT';
/** `available` or `unavailable`: the sandbox check unattended builds get (tests only; story 5.2). */
export const SANDBOX_ENV = 'OGDEN_AGENTS_TEST_SANDBOX';

/** The kind a run records under {@link SANDBOX_ENV} = `available`. */
export const TEST_SANDBOX_KIND = 'test';

/** The reason a build is refused under {@link SANDBOX_ENV} = `unavailable`. */
export const TEST_SANDBOX_UNAVAILABLE_REASON = 'The test sandbox is unavailable.';

/**
 * The sandbox check from {@link SANDBOX_ENV}, or `undefined` (the real
 * probe): unset, hooks not allowed. Allowed but neither value throws, so the
 * test fails loudly rather than probing the real sandbox.
 */
export function testSandbox(env: Env, dataDir: string, tmp: string = tmpdir()): SandboxCheck | undefined {
  const value = env[SANDBOX_ENV];
  if (value === undefined || value === '' || !testHooksAllowed(env, dataDir, tmp)) return undefined;
  if (value === 'available') return { available: true, kind: TEST_SANDBOX_KIND };
  if (value === 'unavailable') return { available: false, reason: TEST_SANDBOX_UNAVAILABLE_REASON };
  // As Windows answers (story 5.6): building with you watching first.
  if (value === 'unavailable-windows') return { available: false, reason: TEST_SANDBOX_UNAVAILABLE_REASON, choices: ['attended', 'install_docker', 'other_agent'] };
  throw new Error(`${SANDBOX_ENV}: must be available, unavailable or unavailable-windows`);
}

/** Test-only: shortens the quiet-agent check-in delay, in milliseconds (story 2.10). Honoured only when `testHooksAllowed`. */
export const CHECK_IN_MS_ENV = 'OGDEN_AGENTS_TEST_CHECK_IN_MS';
/**
 * Set to `memory` (tests that start the packaged server as its own process:
 * the launcher tests and the installed-package smoke) to keep API keys in
 * memory, so no test ever reads or writes the real OS keychain. Honoured only
 * under a test runner (`NODE_ENV=test` or `VITEST` set) on a data folder inside
 * the OS temp folder ({@link testSecretStore}, `testHooksAllowed`).
 */
export const SECRET_STORE_ENV = 'OGDEN_AGENTS_TEST_SECRET_STORE';

/** `memory` when a test asked for the in-memory secret store and test hooks are allowed for `dataDir`; otherwise `undefined` (the keychain). */
export function testSecretStore(env: Env, dataDir: string, tmp: string = tmpdir()): 'memory' | undefined {
  return env[SECRET_STORE_ENV] === 'memory' && testHooksAllowed(env, dataDir, tmp) ? 'memory' : undefined;
}

/** Whether this process runs under a test runner: `NODE_ENV=test`, or `VITEST` set. */
export function isTestRun(env: Env = process.env): boolean {
  return env.NODE_ENV === 'test' || (env.VITEST !== undefined && env.VITEST !== '');
}

/** `path`'s real path, or `undefined` when it can't be resolved (missing, say). */
function real(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

/** Whether `path` (resolved) is strictly inside the OS temp folder (resolved too: macOS's `/var` is `/private/var`). */
export function insideTemp(path: string, tmp: string = tmpdir()): boolean {
  const target = real(path);
  const root = real(tmp);
  if (target === undefined || root === undefined) return false;
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Whether test hooks may act at all: a test run whose data folder is inside the OS temp folder. */
export function testHooksAllowed(env: Env, dataDir: string, tmp: string = tmpdir()): boolean {
  return isTestRun(env) && insideTemp(dataDir, tmp);
}

/** What {@link testClaudeInstall} gives `start()`'s Claude Code install. */
export interface TestClaudeInstall {
  pins: AdapterPins;
  npmCli?: string;
}

const INTEGRITY = /^sha512-[A-Za-z0-9+/]+=*$/;

/**
 * The test install source from {@link CLAUDE_INSTALL_ENV}, or `undefined`
 * (the shipped pins): unset, hooks not allowed, the file outside the temp
 * folder, or a locked package that isn't a local `file:` fixture. Allowed
 * but unusable (unreadable, malformed, no integrity) throws, so the test
 * fails loudly rather than reaching the registry.
 */
export function testClaudeInstall(env: Env, dataDir: string, tmp: string = tmpdir()): TestClaudeInstall | undefined {
  return testNpmInstall(CLAUDE_INSTALL_ENV, env, dataDir, tmp);
}

/** Codex's test install source from {@link CODEX_INSTALL_ENV}, checked as {@link testClaudeInstall}'s is (epic 12 entry 6). */
export function testCodexInstall(env: Env, dataDir: string, tmp: string = tmpdir()): TestClaudeInstall | undefined {
  return testNpmInstall(CODEX_INSTALL_ENV, env, dataDir, tmp);
}

function testNpmInstall(name: string, env: Env, dataDir: string, tmp: string): TestClaudeInstall | undefined {
  const file = env[name];
  if (file === undefined || file === '' || !testHooksAllowed(env, dataDir, tmp)) return undefined;
  const fail = (why: string): never => {
    throw new Error(`${name}: ${why}`);
  };
  if (!isAbsolute(file)) fail('must be an absolute path');
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    fail(`unreadable (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`);
  }
  if (!insideTemp(file, tmp)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('unreadable (bad JSON)');
  }
  const { pins, npmCli } = (parsed ?? {}) as { pins?: Partial<AdapterPins>; npmCli?: unknown };
  const lock = pins?.lock;
  if (pins?.packageJson === undefined || lock === undefined || lock.lockfileVersion !== 3 || typeof lock.packages !== 'object' || lock.packages === null) {
    fail('needs pins with a package.json and a v3 lockfile');
  }
  const entries = Object.entries(lock!.packages as Record<string, { integrity?: unknown; resolved?: unknown }>).filter(([path]) => path !== '');
  if (entries.length === 0) fail('the lockfile pins no package');
  // A local fixture only: anything resolved elsewhere (the registry, a URL) is never installed through this hook.
  if (entries.some(([, entry]) => typeof entry.resolved !== 'string' || !entry.resolved.startsWith('file:'))) return undefined;
  for (const [path, entry] of entries) if (typeof entry.integrity !== 'string' || !INTEGRITY.test(entry.integrity)) fail(`${path} has no sha512 integrity`);
  if (npmCli !== undefined && (typeof npmCli !== 'string' || !isAbsolute(npmCli) || basename(npmCli) !== 'npm-cli.js')) fail('npmCli must be an absolute path to npm-cli.js');
  return { pins: pins as AdapterPins, ...(npmCli === undefined ? {} : { npmCli: npmCli as string }) };
}

/** The API key check from {@link API_KEY_CHECK_ENV}: one that accepts every key, or `undefined` (the real check). */
export function testApiKeyCheck(env: Env, dataDir: string, tmp: string = tmpdir()): ((value: string, signal: AbortSignal) => Promise<ApiKeyVerification>) | undefined {
  return env[API_KEY_CHECK_ENV] === 'accept' && testHooksAllowed(env, dataDir, tmp) ? async () => 'ok' : undefined;
}

/**
 * The `claude` stand-in from {@link CLAUDE_CLI_ENV}, by its real path, or
 * `undefined` (the usual lookup): unset, hooks not allowed, or the file
 * outside the temp folder (never looked at further). Only a Node script
 * (`.js`, `.mjs`, `.cjs`) counts, which the terminal runs under Node, never a
 * shell (no `.cmd`, as story 3.8's lookup). Allowed but unusable (a relative
 * path, another kind of file, no such file) throws, so the test fails loudly
 * rather than running whatever `claude` is found. The script runs with the
 * agents' environment and can do whatever a test asks of it: the hook only
 * picks which file starts.
 */
export function testClaudeCli(env: Env, dataDir: string, tmp: string = tmpdir()): string | undefined {
  return testNodeScript(CLAUDE_CLI_ENV, env, dataDir, tmp);
}

/**
 * The Node script {@link ANTIGRAVITY_SERVER_ENV} names, checked as
 * {@link testClaudeCli}'s is (inside the temp folder by its real path, a
 * `.js`/`.mjs`/`.cjs` file), or `undefined` (Antigravity's pinned server):
 * unset, hooks not allowed, or outside the temp folder. It runs under this
 * Node with Antigravity's own chat environment, in place of the pinned
 * server; nothing else about Antigravity changes (its setup still reads the
 * data folder).
 */
export function testAntigravityServer(env: Env, dataDir: string, tmp: string = tmpdir()): string | undefined {
  return testNodeScript(ANTIGRAVITY_SERVER_ENV, env, dataDir, tmp);
}

/** What {@link testAntigravityInstall} gives Antigravity's setup: its pins. */
export interface TestAntigravityInstall {
  pins: AntigravityPins;
}

/**
 * Antigravity's test pins from {@link ANTIGRAVITY_INSTALL_ENV}, or
 * `undefined` (the shipped pins): unset, hooks not allowed, the file outside
 * the temp folder. Allowed but unusable (a relative path, unreadable,
 * malformed pins, an archive URL that is not `http://127.0.0.1`, or no
 * {@link ANTIGRAVITY_SERVER_ENV} beside it) throws, so the test fails loudly
 * rather than installing from Google.
 */
export function testAntigravityInstall(env: Env, dataDir: string, tmp: string = tmpdir()): TestAntigravityInstall | undefined {
  const file = env[ANTIGRAVITY_INSTALL_ENV];
  if (file === undefined || file === '' || !testHooksAllowed(env, dataDir, tmp)) return undefined;
  const fail = (why: string): never => {
    throw new Error(`${ANTIGRAVITY_INSTALL_ENV}: ${why}`);
  };
  if (!isAbsolute(file)) fail('must be an absolute path');
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    fail(`unreadable (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`);
  }
  if (!insideTemp(file, tmp)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('unreadable (bad JSON)');
  }
  const pins = (parsed as { pins?: Partial<AntigravityPins> } | null)?.pins;
  if (typeof pins?.registry !== 'string' || typeof pins.version !== 'string' || typeof pins.archives !== 'object' || pins.archives === null) {
    fail('needs pins with a registry, a version and archives');
  }
  for (const pin of Object.values(pins!.archives!)) {
    if (typeof pin?.url !== 'string' || typeof pin.sha256 !== 'string' || typeof pin.size !== 'number' || typeof pin.files !== 'object') fail('an archive pin needs a url, sha256, size and files');
    let url: URL | undefined;
    try {
      url = new URL(pin!.url);
    } catch {
      url = undefined;
    }
    // A local fixture only: an archive anywhere but this computer's loopback is refused loudly, never fetched (nor the shipped pins used instead).
    if (url?.protocol !== 'http:' || url.hostname !== '127.0.0.1') fail('every archive url must be http://127.0.0.1');
  }
  // Its installed server is the fake: without the server hook the shipped server would run.
  if (env[ANTIGRAVITY_SERVER_ENV] === undefined || env[ANTIGRAVITY_SERVER_ENV] === '') fail(`needs ${ANTIGRAVITY_SERVER_ENV} too`);
  return { pins: pins as AntigravityPins };
}

/** The Node script {@link CODEX_SERVER_ENV} names (see {@link testClaudeCli}), or `undefined` (Codex's pinned adapter); throws when allowed but unusable. */
export function testCodexServer(env: Env, dataDir: string, tmp: string = tmpdir()): string | undefined {
  return testNodeScript(CODEX_SERVER_ENV, env, dataDir, tmp);
}

/** The Node script {@link GROK_SERVER_ENV} names (see {@link testClaudeCli}), or `undefined` (Grok's checked binary); throws when allowed but unusable. */
export function testGrokServer(env: Env, dataDir: string, tmp: string = tmpdir()): string | undefined {
  return testNodeScript(GROK_SERVER_ENV, env, dataDir, tmp);
}

/** The trust-needing test agent's script from {@link TRUST_AGENT_ENV} (see {@link testClaudeCli}), or `undefined`; throws when allowed but unusable. */
export function testTrustAgent(env: Env, dataDir: string, tmp: string = tmpdir()): string | undefined {
  return testNodeScript(TRUST_AGENT_ENV, env, dataDir, tmp);
}

/** A Node script inside the temp folder named by `name` (see {@link testClaudeCli}), or `undefined`; throws when allowed but unusable. */
function testNodeScript(name: string, env: Env, dataDir: string, tmp: string): string | undefined {
  const file = env[name];
  if (file === undefined || file === '' || !testHooksAllowed(env, dataDir, tmp)) return undefined;
  if (!isAbsolute(file)) throw new Error(`${name}: must be an absolute path`);
  if (!/\.[cm]?js$/i.test(file)) throw new Error(`${name}: must be a Node script (.js, .mjs or .cjs)`);
  if (!insideTemp(dirname(file), tmp)) return undefined;
  let target: string;
  try {
    target = realpathSync.native(file);
  } catch (error) {
    throw new Error(`${name}: unreadable (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`);
  }
  // Checked again by its real path, which is what every later spawn uses: a link can't lead out of temp.
  if (!insideTemp(target, tmp) || !/\.[cm]?js$/i.test(target)) return undefined;
  if (!statSync(target).isFile()) throw new Error(`${name}: not a file`);
  return target;
}

/** What {@link testBmadSource} gives `start()`: the fixture lock, its tarball's real path, and the uv variables. */
export interface TestBmadSource {
  lock: BmadLock;
  tarball: string;
  uvEnv: Record<string, string>;
}

/**
 * The fixture BMad Method source from {@link BMAD_SOURCE_ENV}, or `undefined`
 * (upstream's pinned tarball, downloaded when the user asks): unset, hooks
 * not allowed, or the file or the tarball (by its real path) outside the temp
 * folder. Allowed but unusable (a relative path, unreadable, bad JSON, a lock
 * the shared schema refuses, no tarball file) throws, so the test fails
 * loudly rather than reaching GitHub. `uvEnv` keeps only
 * {@link BMAD_SOURCE_UV_ENV_NAMES} with string values.
 */
export function testBmadSource(env: Env, dataDir: string, tmp: string = tmpdir()): TestBmadSource | undefined {
  const file = env[BMAD_SOURCE_ENV];
  if (file === undefined || file === '' || !testHooksAllowed(env, dataDir, tmp)) return undefined;
  const fail = (why: string): never => {
    throw new Error(`${BMAD_SOURCE_ENV}: ${why}`);
  };
  if (!isAbsolute(file)) fail('must be an absolute path');
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    fail(`unreadable (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`);
  }
  if (!insideTemp(file, tmp)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('unreadable (bad JSON)');
  }
  const { lock, tarball, uvEnv } = (parsed ?? {}) as { lock?: unknown; tarball?: unknown; uvEnv?: unknown };
  const pinned = BmadLock.safeParse(lock);
  if (!pinned.success) fail('needs a lock the shared BmadLock schema accepts');
  if (typeof tarball !== 'string' || !isAbsolute(tarball)) fail('tarball must be an absolute path');
  let target = '';
  try {
    target = realpathSync.native(tarball as string);
  } catch (error) {
    fail(`tarball unreadable (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`);
  }
  // Checked by its real path, which is what the source reads: a link can't lead out of temp.
  if (!insideTemp(target, tmp)) return undefined;
  if (!statSync(target).isFile()) fail('tarball is not a file');
  const extra: Record<string, string> = {};
  if (uvEnv !== undefined && uvEnv !== null && typeof uvEnv === 'object') {
    for (const [name, value] of Object.entries(uvEnv as Record<string, unknown>)) if (BMAD_SOURCE_UV_ENV_NAMES.includes(name) && typeof value === 'string') extra[name] = value;
  }
  return { lock: pinned.data!, tarball: target, uvEnv: extra };
}

/** Whether to register the test-only BMad probe route ({@link BMAD_PROBE_ENV}): only when set to `1` and test hooks are allowed. */
export function testBmadProbe(env: Env, dataDir: string, tmp: string = tmpdir()): boolean {
  return env[BMAD_PROBE_ENV] === '1' && testHooksAllowed(env, dataDir, tmp);
}

/**
 * The BMad pieces {@link BMAD_AVAILABLE_ENV} adds to what this install
 * ships, in the order given without repeats, or none: unset, empty, or hooks
 * not allowed. Allowed but naming something that isn't a piece throws, so
 * the test fails loudly rather than running with less than it asked for.
 */
export function testBmadAvailable(env: Env, dataDir: string, tmp: string = tmpdir()): BmadPieceName[] {
  const list = env[BMAD_AVAILABLE_ENV];
  if (list === undefined || list.trim() === '' || !testHooksAllowed(env, dataDir, tmp)) return [];
  const pieces: BmadPieceName[] = [];
  for (const name of list.split(',').map((part) => part.trim())) {
    const parsed = BmadPiece.safeParse(name);
    if (!parsed.success) throw new Error(`${BMAD_AVAILABLE_ENV}: ${JSON.stringify(name)} is not a BMad piece`);
    if (!pieces.includes(parsed.data)) pieces.push(parsed.data);
  }
  return pieces;
}

/**
 * The check-in delay from {@link CHECK_IN_MS_ENV}, clamped to core's range
 * (`clampCheckInDelay`: 1 s to 2^31-1 ms), or `undefined` (core's 10 minutes)
 * when unset, not a number, or test hooks aren't allowed for `dataDir`
 * (`testHooksAllowed`: a test run on a data folder inside the OS temp folder).
 */
export function checkInDelayFromEnv(env: Env, dataDir: string, tmp: string = tmpdir()): number | undefined {
  const raw = env[CHECK_IN_MS_ENV];
  if (raw === undefined || raw.trim() === '' || !testHooksAllowed(env, dataDir, tmp)) return undefined;
  const ms = Number(raw);
  return Number.isFinite(ms) ? clampCheckInDelay(ms) : undefined;
}

/** The `start()` options that decide a hook themselves, and whether `start()` opens its own core. */
export type TestHookOptions = Pick<StartOptions, 'claudeInstall' | 'verifyApiKey' | 'extraAgentEnv' | 'checkInDelayMs' | 'secrets' | 'bmadSource' | 'bmadFetch' | 'antigravity' | 'codex' | 'grok' | 'extraAgents' | 'sandbox'> & {
  /** `false` for a core passed in, which already holds its own BMad pieces: {@link BMAD_AVAILABLE_ENV} is not read. */
  ownsCore: boolean;
  tmp?: string;
};

/** Every honoured hook, as {@link resolveTestHooks} found them. */
export interface TestHooks {
  claudeInstall: TestClaudeInstall | undefined;
  apiKeyCheck: ((value: string, signal: AbortSignal) => Promise<ApiKeyVerification>) | undefined;
  claudeCli: string | undefined;
  antigravityServer: string | undefined;
  antigravityInstall: TestAntigravityInstall | undefined;
  codexServer: string | undefined;
  codexInstall: TestClaudeInstall | undefined;
  grokServer: string | undefined;
  trustAgent: string | undefined;
  bmadProbe: boolean;
  bmadAvailable: BmadPieceName[];
  bmadSource: TestBmadSource | undefined;
  checkInMs: number | undefined;
  secretStore: 'memory' | undefined;
  sandbox: SandboxCheck | undefined;
}

/**
 * Reads every hook for `start()`, each through its own function above (so
 * each is honoured only when {@link testHooksAllowed}), except one that
 * `options` already decides (a given install, key check, `claude`
 * executable, BMad Method source or fetch, check-in delay or secret store),
 * which is not read at all.
 * Throws as those functions do.
 */
export function resolveTestHooks(env: Env, dataDir: string, options: TestHookOptions): TestHooks {
  const tmp = options.tmp ?? tmpdir();
  return {
    claudeInstall: options.claudeInstall === undefined ? testClaudeInstall(env, dataDir, tmp) : undefined,
    apiKeyCheck: options.verifyApiKey === undefined ? testApiKeyCheck(env, dataDir, tmp) : undefined,
    claudeCli: options.extraAgentEnv?.CLAUDE_CODE_EXECUTABLE === undefined ? testClaudeCli(env, dataDir, tmp) : undefined,
    // Antigravity's ports given (or left out) by a test decide it: the hook is not read.
    antigravityServer: options.antigravity === undefined ? testAntigravityServer(env, dataDir, tmp) : undefined,
    antigravityInstall: options.antigravity === undefined ? testAntigravityInstall(env, dataDir, tmp) : undefined,
    // Codex's ports given (or left out) by a test decide it: the hook is not read.
    codexServer: options.codex === undefined ? testCodexServer(env, dataDir, tmp) : undefined,
    codexInstall: options.codex === undefined ? testCodexInstall(env, dataDir, tmp) : undefined,
    // Grok's ports given (or left out) by a test decide it: the hook is not read.
    grokServer: options.grok === undefined ? testGrokServer(env, dataDir, tmp) : undefined,
    // Agents a test registers decide it: the hook is not read.
    trustAgent: options.extraAgents === undefined ? testTrustAgent(env, dataDir, tmp) : undefined,
    bmadProbe: testBmadProbe(env, dataDir, tmp),
    bmadAvailable: options.ownsCore ? testBmadAvailable(env, dataDir, tmp) : [],
    bmadSource: options.bmadSource === undefined && options.bmadFetch === undefined ? testBmadSource(env, dataDir, tmp) : undefined,
    checkInMs: options.checkInDelayMs === undefined ? checkInDelayFromEnv(env, dataDir, tmp) : undefined,
    secretStore: options.secrets === undefined ? testSecretStore(env, dataDir, tmp) : undefined,
    sandbox: options.sandbox === undefined ? testSandbox(env, dataDir, tmp) : undefined,
  };
}

/**
 * The fields of the "test hooks in use" log line, or `undefined` when no hook
 * is in use. `checkInMs` appears only when honoured. The memory secret store
 * keeps its own "secrets store" line: every vitest server sets it.
 */
export function testHooksLogFields(hooks: TestHooks): Record<string, unknown> | undefined {
  const inUse =
    hooks.claudeInstall !== undefined ||
    hooks.apiKeyCheck !== undefined ||
    hooks.claudeCli !== undefined ||
    hooks.antigravityServer !== undefined ||
    hooks.antigravityInstall !== undefined ||
    hooks.codexServer !== undefined ||
    hooks.codexInstall !== undefined ||
    hooks.grokServer !== undefined ||
    hooks.trustAgent !== undefined ||
    hooks.bmadProbe ||
    hooks.bmadAvailable.length > 0 ||
    hooks.bmadSource !== undefined ||
    hooks.checkInMs !== undefined ||
    hooks.sandbox !== undefined;
  if (!inUse) return undefined;
  return {
    claudeInstall: hooks.claudeInstall !== undefined,
    apiKeyCheck: hooks.apiKeyCheck !== undefined,
    claudeCli: hooks.claudeCli !== undefined,
    antigravityServer: hooks.antigravityServer !== undefined,
    antigravityInstall: hooks.antigravityInstall !== undefined,
    codexServer: hooks.codexServer !== undefined,
    codexInstall: hooks.codexInstall !== undefined,
    grokServer: hooks.grokServer !== undefined,
    trustAgent: hooks.trustAgent !== undefined,
    bmadProbe: hooks.bmadProbe,
    bmadAvailable: hooks.bmadAvailable.join(','),
    bmadSource: hooks.bmadSource !== undefined,
    ...(hooks.sandbox === undefined ? {} : { sandbox: hooks.sandbox.available ? 'available' : 'unavailable' }),
    ...(hooks.checkInMs === undefined ? {} : { checkInMs: hooks.checkInMs }),
  };
}
