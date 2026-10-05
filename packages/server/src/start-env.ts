/**
 * What the server takes from its environment (moved from `start.ts`, story
 * 3.9): the environment agent processes get (AD-16), the agent keys core's
 * precedence rule reads (story 9.2). The test-only switches moved to
 * `test-hooks.ts` (story 10.8) and are re-exported here.
 */
import { ANTIGRAVITY_DESCRIPTOR, baseEnvironment, CLAUDE_CODE_DESCRIPTOR, CODEX_DESCRIPTOR, GROK_DESCRIPTOR } from '@ogden-agents/adapters';
import { agentEnvKeys } from '@ogden-agents/core';

// The test-only switches live with every other test hook; re-exported so imports stay the same (story 10.8).
export { CHECK_IN_MS_ENV, checkInDelayFromEnv, SECRET_STORE_ENV, testSecretStore } from './test-hooks.js';

/**
 * How old the subscription state may be when a Claude Code chat starts: older,
 * it is read again first, so a sign-in made outside the app stops the API key
 * being used within this long (story 9.2 review F4).
 */
export const SUBSCRIPTION_MAX_AGE_MS = 30_000;

/**
 * Agent credentials the user may set in this server's environment (AD-16):
 * every API key variable of each registered agent, from its descriptor
 * (6.3; `agentEnvKeys`). They are not in the agent allowlist: core's
 * precedence rule decides (story 9.2), exactly as for a saved key, which
 * comes first. A chat process gets its own agent's only while the
 * subscription is known to be signed out; sign-in and `auth status` never do
 * ({@link withoutAgentKeys}). This is the shipped agents' list; `start()`
 * derives its own from the agents it registers.
 */
export const AGENT_ENV_KEYS: readonly string[] = agentEnvKeys([CLAUDE_CODE_DESCRIPTOR, ANTIGRAVITY_DESCRIPTOR, CODEX_DESCRIPTOR, GROK_DESCRIPTOR]);

/** Only the `keys` (default {@link AGENT_ENV_KEYS}) of `env`, whatever their case, for core's precedence rule. Never logged. */
export function agentKeysOf(env: Readonly<Record<string, string | undefined>>, names: readonly string[] = AGENT_ENV_KEYS): Record<string, string> {
  const keys = new Set(names.map((name) => name.toUpperCase()));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined && keys.has(name.toUpperCase())) out[name] = value;
  return out;
}

/** `env` without any of `keys` (default {@link AGENT_ENV_KEYS}), whatever their case (Windows names are case-insensitive). */
export function withoutAgentKeys(env: Readonly<Record<string, string>>, names: readonly string[] = AGENT_ENV_KEYS): Record<string, string> {
  const keys = new Set(names.map((name) => name.toUpperCase()));
  return Object.fromEntries(Object.entries(env).filter(([name]) => !keys.has(name.toUpperCase())));
}

/**
 * The environment agent processes get (AD-16): the base allowlist
 * (`child-env.ts`: what a CLI needs to run as the user), and nothing else of
 * this server's environment. Agent keys are added only by core's precedence
 * rule (story 9.2), each to its own agent's process. Never logged.
 */
export function agentEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  return baseEnvironment(source, platform);
}

/**
 * The environment every `uv` process gets (story 4.1): moved to the
 * `toolchain-uv` adapter by story 4.2, so the version probe and every script
 * run share one allowlist; re-exported here so imports stay the same.
 */
export { uvEnvironment } from '@ogden-agents/adapters';
