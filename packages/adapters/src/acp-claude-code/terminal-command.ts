/**
 * Claude Code's own terminal on a chat's session (story 3.1, CAP-5):
 * `claude --resume <ACP session id>`. Claude Agent ACP passes its ACP session
 * id to the Agent SDK as the CLI's session id, so the CLI resumes the same
 * conversation from the workspace folder it was started in.
 *
 * The same `claude` as the chat's adapter runs: `CLAUDE_CODE_EXECUTABLE` in
 * the chat's environment, else the user's own CLI ({@link findClaudeExecutable}),
 * else the Agent SDK's bundled binary, found the way claude-agent-acp's
 * `claudeCliPath` finds it. A script (`.js`, `.mjs`, `.cjs`) runs under
 * Node, as the Agent SDK runs one. Always an argument array, never a shell.
 */
import { createRequire } from 'node:module';
import { AgentError, type AgentTerminalCommand } from '@ogden-agents/core';
import { findClaudeExecutable } from './detect.js';

/** What a session id must look like to go on the command line: never an option, never a path. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface ClaudeTerminalOptions {
  /** As `ClaudeCodeAgentOptions.claudeExecutable`: `null` skips looking for the user's own CLI. */
  claudeExecutable?: string | null | undefined;
  /** The Claude Agent ACP adapter's entry script, whose Agent SDK has the bundled binary. */
  adapterPath?: string | undefined;
  /** The Node that runs a script CLI. Default: this one. */
  nodePath?: string | undefined;
}

/**
 * The Agent SDK's bundled `claude` for this platform, resolved from the
 * adapter's own dependencies (claude-agent-acp's `claudeCliPath`), or
 * `undefined` when it isn't installed.
 */
export function bundledClaudeExecutable(adapterPath: string | undefined): string | undefined {
  if (adapterPath === undefined) return undefined;
  try {
    const sdk = createRequire(adapterPath).resolve('@anthropic-ai/claude-agent-sdk');
    const require = createRequire(sdk);
    const ext = process.platform === 'win32' ? '.exe' : '';
    const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
    // On Linux the variant matching this Node's libc first: the other one crashes instead of failing to start.
    const musl = process.platform === 'linux' && !(process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header?.glibcVersionRuntime;
    const candidates =
      process.platform !== 'linux' ? [`${base}/claude${ext}`] : musl ? [`${base}-musl/claude`, `${base}/claude`] : [`${base}/claude`, `${base}-musl/claude`];
    for (const candidate of candidates) {
      try {
        return require.resolve(candidate);
      } catch {
        // The next one.
      }
    }
  } catch {
    // No Agent SDK beside the adapter.
  }
  return undefined;
}

export function claudeTerminalCommand(
  agentSessionId: string,
  env: Readonly<Record<string, string>>,
  options: ClaudeTerminalOptions = {},
): AgentTerminalCommand {
  if (!SESSION_ID.test(agentSessionId)) throw new AgentError('agent_unavailable', "This chat's Claude Code session can't be opened in a terminal.");
  const claude =
    env.CLAUDE_CODE_EXECUTABLE ||
    (options.claudeExecutable === undefined ? findClaudeExecutable(env) : (options.claudeExecutable ?? undefined)) ||
    bundledClaudeExecutable(options.adapterPath);
  if (claude === undefined) throw new AgentError('agent_unavailable', "Claude Code's terminal couldn't be found on this computer.");
  const args = ['--resume', agentSessionId];
  return /\.[cm]?js$/i.test(claude) ? { file: options.nodePath ?? process.execPath, args: [claude, ...args], env } : { file: claude, args, env };
}
