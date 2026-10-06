/**
 * `acp-claude-code` (story 2.2): core's `AgentPort` for Claude Code, through
 * the Claude Agent ACP adapter (`@agentclientprotocol/claude-agent-acp`).
 * Since 6.4 it is Claude Code's descriptor plus its quirks on the shared ACP
 * client (`acp-base`), which does the ACP wiring, states, reopen order,
 * permission requests, modes, masking, timeouts and stopping the tree.
 *
 * What is Claude Code's own:
 *
 * - The adapter is not a dependency of the published package (about 230 MB
 *   with its bundled CLI); it is found at a configurable path, by default
 *   resolved from `node_modules` where a dev install has it. Onboarding
 *   (story 9.3) installs it on demand into the data folder; the server then
 *   passes a function that finds it at each start. It is run by Node.
 * - The adapter runs the user's own `claude` when one is found, through
 *   `CLAUDE_CODE_EXECUTABLE`, so their login and version are used; otherwise
 *   it falls back to the Agent SDK's bundled binary.
 * - Permission modes: the ACP session modes the adapter lists (`default`,
 *   `acceptEdits`, `plan`, `auto`, `bypassPermissions`) map to Ogden's Ask,
 *   Auto and Skip all (`default`, `auto`, `bypassPermissions`). The adapter
 *   is started with skipping permitted (its default), so a chat can move to
 *   Skip all without a restart: Ogden's server is the gate. The plan-exit
 *   card's mode-raising options are `allow_always`, so a card never picks one.
 * - Protected paths stay guarded in Auto as ask rules in its flag settings
 *   (`_meta.claudeCode.options.settings`).
 * - Its tools name paths in `file_path`, `notebook_path` and `path`, and
 *   searches in `pattern` and `glob`.
 * - `claude --resume <id>` is its terminal, and its session record is read
 *   back (stories 3.2, 3.3).
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import { AgentError, type AgentPort } from '@ogden-agents/core';
import type { PermissionMode } from '@ogden-agents/shared';
import { acpAsksLessThanAsk, acpModeOf, acpReasons, createAcpAgent, slashSkillInvocation, type AcpAgentQuirks } from '../acp-base/acp-agent.js';
import { toolCallPaths, type AcpToolInputPaths } from '../acp-base/tool-paths.js';
import { CLAUDE_CODE_DESCRIPTOR } from '../setup-claude-code/descriptor.js';
import { claudeSessionOptions } from './claude-guards.js';
import { ACP_MODE_IDS, CLAUDE_AGENT_ACP_PACKAGE, CLAUDE_CODE } from './constants.js';
import { findClaudeExecutable } from './detect.js';
import { claudeTerminalCommand, locateClaudeTerminal } from './terminal-command.js';
import { readClaudeTranscript } from './transcript.js';

export { ACP_MODE_IDS, CLAUDE_AGENT_ACP_PACKAGE, CLAUDE_CODE } from './constants.js';
export { EXIT_GRACE_MS, START_TIMEOUT_MS } from '../acp-base/acp-agent.js';

export interface ClaudeCodeAgentOptions {
  /**
   * The adapter's entry script (`claude-agent-acp`'s `dist/index.js`), or
   * any script that speaks ACP over stdio (the tests' fake agent), or a
   * function read at each start (so an adapter installed while the server
   * runs is used without a restart, story 9.3). Default: resolved from
   * `node_modules` ({@link resolveClaudeAgentAcp}).
   */
  adapterPath?: string | (() => string | undefined) | undefined;
  /**
   * The `claude` CLI the adapter runs. Default: one found on `PATH` or at
   * Claude Code's install locations ({@link findClaudeExecutable}); `null`
   * lets the adapter use its bundled binary. A `CLAUDE_CODE_EXECUTABLE` in
   * the environment core passes wins over both.
   */
  claudeExecutable?: string | null | undefined;
  /** The Node that runs the adapter. Default: this one. */
  nodePath?: string;
  /** Called with the adapter's protocol notes, for the log. Never includes the environment. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
  /** Default `START_TIMEOUT_MS`. */
  startTimeoutMs?: number;
}

/** The adapter's entry script in `node_modules`, or `undefined` when it isn't installed. */
export function resolveClaudeAgentAcp(from: string | URL = import.meta.url): string | undefined {
  try {
    const manifest = createRequire(from).resolve(`${CLAUDE_AGENT_ACP_PACKAGE}/package.json`);
    const entry = join(dirname(manifest), 'dist', 'index.js');
    return existsSync(entry) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/** The Ogden mode an ACP session mode is, or `other` (planning, accepting edits, anything else). */
export function ogdenModeOf(modeId: string): PermissionMode | 'other' {
  return acpModeOf(ACP_MODE_IDS, modeId);
}

/** ACP session modes that ask as much as Ask does (or more); any other, known or not, asks less. */
const ASKING_MODE_IDS = ['default', 'plan', 'dontAsk'] as const;

/** Whether an ACP session mode asks less than Ask (so core tells the agent Ask). An unknown one does, to be safe. */
export function asksLessThanAsk(modeId: string): boolean {
  return acpAsksLessThanAsk(ASKING_MODE_IDS, modeId);
}

/** Input fields that name a file or folder, in the tools Claude Code reports; and a search's (Glob's `pattern`, Grep's `glob` and `pattern`, story 2.8 review F2). */
const TOOL_INPUT_PATHS: AcpToolInputPaths = { pathFields: ['file_path', 'notebook_path', 'path'], patternFields: ['pattern', 'glob'] };

/** Every path a Claude Code tool call names (see `toolCallPaths`). */
export function pathsOf(toolCall: acp.ToolCallUpdate, cwd: string): string[] {
  return toolCallPaths(toolCall, cwd, TOOL_INPUT_PATHS);
}

export function createClaudeCodeAgent(options: ClaudeCodeAgentOptions = {}): AgentPort {
  /** The adapter's entry script as things stand now (a function is asked each time; 9.3). */
  const currentAdapterPath = () => {
    const given = typeof options.adapterPath === 'function' ? options.adapterPath() : options.adapterPath;
    return typeof options.adapterPath === 'function' ? given : (given ?? resolveClaudeAgentAcp());
  };

  const quirks: AcpAgentQuirks = {
    // Node runs the adapter, with the user's `claude` when one is found.
    launch({ env }) {
      const adapterPath = currentAdapterPath();
      if (adapterPath === undefined || !existsSync(adapterPath)) {
        throw new AgentError('agent_unavailable', acpReasons(CLAUDE_CODE).notSetUp, { details: { adapterPath: adapterPath ?? null } });
      }
      // A `CLAUDE_CODE_EXECUTABLE` core passes wins (the base keeps core's variables over additions).
      const claude = env.CLAUDE_CODE_EXECUTABLE ?? (options.claudeExecutable === undefined ? findClaudeExecutable(env) : options.claudeExecutable) ?? undefined;
      return {
        command: options.nodePath ?? process.execPath,
        args: [adapterPath],
        addEnv: claude === undefined ? undefined : { CLAUDE_CODE_EXECUTABLE: claude },
        logFields: { adapterPath, claudeExecutable: claude ?? 'bundled' },
      };
    },
    // claude-agent-acp 0.84 passes `_meta.claudeCode.options.settings` to the CLI as its flag settings; it can't be changed later.
    sessionMeta: (protectedPaths, sandbox, attended) => {
      const options = claudeSessionOptions(protectedPaths, sandbox, attended === true);
      return options === undefined ? undefined : { claudeCode: { options } };
    },
    toolInputPaths: TOOL_INPUT_PATHS,
    askingModeIds: ASKING_MODE_IDS,
    // `claude --resume <id>` (CAP-5), and its record read back (story 3.3).
    terminalResume: {
      transcript: readClaudeTranscript,
      command: async (agentSessionId, env, terminal) =>
        claudeTerminalCommand(agentSessionId, env, { ...options, adapterPath: currentAdapterPath(), permissionMode: terminal?.permissionMode ?? 'ask', protectedPaths: terminal?.protectedPaths, model: terminal?.model }),
      locate: async (env) => locateClaudeTerminal(env, { ...options, adapterPath: currentAdapterPath() }),
    },
    // Claude Code's ACP adapter hands the text to the SDK, which runs `/name` as the installed skill; it loads the
    // repo's own skills from the session's cwd (`settingSources` includes `project`). The idea follows as its argument (stories 4.1, 4.2).
    skillInvocation: slashSkillInvocation,
  };

  return createAcpAgent(CLAUDE_CODE_DESCRIPTOR, quirks, {
    onDiagnostic: options.onDiagnostic,
    startTimeoutMs: options.startTimeoutMs,
  });
}
