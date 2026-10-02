/**
 * What the server takes from its environment (moved from `start.ts`, story
 * 3.9): the environment agent processes get (AD-16), the agent keys core's
 * precedence rule reads (story 9.2). The test-only switches moved to
 * `test-hooks.ts` (story 10.8) and are re-exported here.
 */
// The test-only switches live with every other test hook; re-exported so imports stay the same (story 10.8).
export { CHECK_IN_MS_ENV, checkInDelayFromEnv, SECRET_STORE_ENV, testSecretStore } from './test-hooks.js';

/**
 * How old the subscription state may be when a Claude Code chat starts: older,
 * it is read again first, so a sign-in made outside the app stops the API key
 * being used within this long (story 9.2 review F4).
 */
export const SUBSCRIPTION_MAX_AGE_MS = 30_000;

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

/**
 * The environment every `uv` process gets (story 4.1): moved to the
 * `toolchain-uv` adapter by story 4.2, so the version probe and every script
 * run share one allowlist; re-exported here so imports stay the same.
 */
export { uvEnvironment } from '@ogden-agents/adapters';
