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
 * - `OGDEN_AGENTS_TEST_SECRET_STORE=memory` (`start.ts`): API keys in memory.
 * - {@link CLAUDE_INSTALL_ENV}: Install takes its pins (and npm) from a JSON
 *   file inside the temp folder instead of the shipped ones. Every locked
 *   package must be a local `file:` fixture with a `sha512-` integrity, so
 *   it never fetches anything and npm still checks it (`npm ci`).
 * - {@link API_KEY_CHECK_ENV} = `accept`: Claude Code's API key check
 *   answers `ok` without reaching Anthropic.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, relative } from 'node:path';
import type { AdapterPins } from '@ogden-agents/adapters';
import type { ApiKeyVerification } from '@ogden-agents/core';

type Env = Readonly<Record<string, string | undefined>>;

/** Path to a JSON file `{ "pins": { "packageJson", "lock" }, "npmCli"?: "<abs>/npm-cli.js" }` (tests only). */
export const CLAUDE_INSTALL_ENV = 'OGDEN_AGENTS_TEST_CLAUDE_INSTALL';
/** `accept`: the API key check answers `ok` without the network (tests only). */
export const API_KEY_CHECK_ENV = 'OGDEN_AGENTS_TEST_API_KEY_CHECK';

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
  const file = env[CLAUDE_INSTALL_ENV];
  if (file === undefined || file === '' || !testHooksAllowed(env, dataDir, tmp)) return undefined;
  const fail = (why: string): never => {
    throw new Error(`${CLAUDE_INSTALL_ENV}: ${why}`);
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
