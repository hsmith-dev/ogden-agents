/**
 * Which of Claude Code's advertised sign-in methods Ogden Agents runs (story
 * 9.1; closes deferred review finding F4). An agent's terminal-type method
 * names arguments and environment for its client to run; they are never
 * run as advertised. Only the one known subscription login is accepted, and
 * what runs is always this Node, the resolved adapter script, and the fixed
 * arguments below: the advertised `_meta` command is ignored.
 */
import type { AgentAuthMethod } from '@ogden-agents/core';

/** The Claude Agent ACP adapter's subscription login (claude-agent-acp 0.84). */
export const CLAUDE_AI_LOGIN_ID = 'claude-ai-login';
/** Its exact arguments, after the adapter script. */
export const CLAUDE_AI_LOGIN_ARGS: readonly string[] = Object.freeze(['--cli', 'auth', 'login', '--claudeai']);
/** What the adapter runs to read the CLI's sign-in state. */
export const CLAUDE_AUTH_STATUS_ARGS: readonly string[] = Object.freeze(['--cli', 'auth', 'status', '--json']);

export const UNSUPPORTED_SIGN_IN = "This version of Claude Code offers a sign-in Ogden Agents can't run.";

export type AuthMethodCheck = { ok: true; args: readonly string[] } | { ok: false; reason: string };

const sameArgs = (given: readonly string[] | undefined) =>
  given !== undefined && given.length === CLAUDE_AI_LOGIN_ARGS.length && given.every((arg, i) => arg === CLAUDE_AI_LOGIN_ARGS[i]);

/**
 * Accepts only a terminal method with id {@link CLAUDE_AI_LOGIN_ID}, exactly
 * {@link CLAUDE_AI_LOGIN_ARGS}, and no environment. Anything else (another
 * id, other or extra arguments, any variable) is refused with the plain
 * reason, and nothing runs.
 */
export function checkAuthMethods(methods: readonly AgentAuthMethod[]): AuthMethodCheck {
  const method = methods.find((candidate) => candidate.id === CLAUDE_AI_LOGIN_ID);
  if (method === undefined || method.kind !== 'terminal') return { ok: false, reason: UNSUPPORTED_SIGN_IN };
  if (!sameArgs(method.args)) return { ok: false, reason: UNSUPPORTED_SIGN_IN };
  if (method.env !== undefined && method.env !== null && Object.keys(method.env).length > 0) return { ok: false, reason: UNSUPPORTED_SIGN_IN };
  return { ok: true, args: CLAUDE_AI_LOGIN_ARGS };
}
