/**
 * What the server takes from its environment (moved from `start.ts`, story
 * 3.9): the environment agent processes get (AD-16), the agent keys core's
 * precedence rule reads (story 9.2), and the test-only switches.
 */
import { clampCheckInDelay } from '@ogden-agents/core';
import { testHooksAllowed } from './test-hooks.js';

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
export function testSecretStore(env: Readonly<Record<string, string | undefined>>, dataDir: string): 'memory' | undefined {
  return env[SECRET_STORE_ENV] === 'memory' && testHooksAllowed(env, dataDir) ? 'memory' : undefined;
}

/**
 * How old the subscription state may be when a Claude Code chat starts: older,
 * it is read again first, so a sign-in made outside the app stops the API key
 * being used within this long (story 9.2 review F4).
 */
export const SUBSCRIPTION_MAX_AGE_MS = 30_000;

/**
 * The check-in delay from {@link CHECK_IN_MS_ENV}, clamped to core's range
 * (`clampCheckInDelay`: 1 s to 2^31-1 ms), or `undefined` (core's 10 minutes)
 * when unset, not a number, or test hooks aren't allowed for `dataDir`
 * (`testHooksAllowed`: a test run on a data folder inside the OS temp folder).
 */
export function checkInDelayFromEnv(env: Readonly<Record<string, string | undefined>>, dataDir: string): number | undefined {
  const raw = env[CHECK_IN_MS_ENV];
  if (raw === undefined || raw.trim() === '' || !testHooksAllowed(env, dataDir)) return undefined;
  const ms = Number(raw);
  return Number.isFinite(ms) ? clampCheckInDelay(ms) : undefined;
}

/** What an agent process needs from this server's environment to run as the user (AD-16). */
const AGENT_ENV_ALLOWED = ['PATH', 'HOME', 'USERPROFILE', 'USER', 'USERNAME', 'LANG', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'SHELL'];
/** The same on Windows only, where a process can't start without them. */
const AGENT_ENV_ALLOWED_WINDOWS = ['SystemRoot', 'ComSpec', 'PATHEXT'];
/**
 * Agent credentials the user may set in this server's environment (AD-16).
 * They are not in the agent allowlist: core's precedence rule decides (story
 * 9.2), exactly as for a saved key, which comes first. A chat process gets
 * one only while the subscription is known to be signed out; sign-in and
 * `auth status` never do ({@link withoutAgentKeys}).
 */
export const AGENT_ENV_KEYS = ['ANTHROPIC_API_KEY'];

/** Only the {@link AGENT_ENV_KEYS} of `env`, whatever their case, for core's precedence rule. Never logged. */
export function agentKeysOf(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const keys = new Set(AGENT_ENV_KEYS.map((name) => name.toUpperCase()));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined && keys.has(name.toUpperCase())) out[name] = value;
  return out;
}

/** `env` without any {@link AGENT_ENV_KEYS}, whatever their case (Windows names are case-insensitive). */
export function withoutAgentKeys(env: Readonly<Record<string, string>>): Record<string, string> {
  const keys = new Set(AGENT_ENV_KEYS.map((name) => name.toUpperCase()));
  return Object.fromEntries(Object.entries(env).filter(([name]) => !keys.has(name.toUpperCase())));
}

/**
 * The environment agent processes get (AD-16): an allowlist of what a CLI
 * needs to run as the user (`PATH`, home, user, locale, terminal, temp,
 * shell), and nothing else of this server's environment. Agent keys are
 * added only by core's precedence rule (story 9.2). Never logged.
 */
export function agentEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const allowed = new Set([...AGENT_ENV_ALLOWED, ...(platform === 'win32' ? AGENT_ENV_ALLOWED_WINDOWS : [])]);
  // Windows variable names are case-insensitive (`Path`, `SYSTEMROOT`).
  const fold = (name: string) => (platform === 'win32' ? name.toUpperCase() : name);
  const allowedFolded = new Set([...allowed].map(fold));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (allowedFolded.has(fold(name)) || name === 'LC_ALL' || name.startsWith('LC_')) env[name] = value;
  }
  return env;
}
