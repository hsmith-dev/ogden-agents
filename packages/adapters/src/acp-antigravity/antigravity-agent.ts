/**
 * `acp-antigravity` (epic 6 entry 5, E6-R4): core's `AgentPort` for Google's
 * Antigravity, through its own ACP server (`agy_acp_server`, registry
 * `antigravity-acp`), on the shared ACP client (`acp-base`, 6.4). What is
 * Antigravity's own, from spike 6.1:
 *
 * - It runs the pinned server unpacked in the data folder (`setup-antigravity`'s
 *   layout; entry 7 installs it), by absolute path, with core's environment:
 *   its `GEMINI_HOME` and, under core's precedence rule, `GEMINI_API_KEY`.
 * - It refuses sessions until a sign-in method is chosen. With a key in its
 *   environment, the client authenticates with `gemini-api-key` first; else
 *   it opens sessions as they are and a refusal (`-32000`) is `auth_required`.
 * - Its process takes about 17 s to answer `initialize` on Windows, every
 *   start (accepted by the user, 2026-10-02): it gets 120 s, and core shows
 *   the chat as starting meanwhile.
 * - Modes: `default` is Ask and `yolo` is Skip all; `auto_edit` is never
 *   offered (it approves protected files), and only `default` asks as much
 *   as Ask, so a switch to anything else drops the chat to Ask.
 * - Cards answer its `allow_once` and `reject_once` options only (its
 *   "Allow Always" is never picked; Always allow stays core's).
 * - It reopens with `session/resume`, else `session/load`, else core's
 *   stored-transcript fallback; there is no terminal resume (the archive has
 *   no `agy` CLI, and the server keeps sessions in its own store), so the
 *   toggle reports `agent_unsupported`.
 */
import { AgentError, type AgentPort } from '@ogden-agents/core';
import { acpReasons, createAcpAgent, slashSkillInvocation, type AcpAgentQuirks } from '../acp-base/acp-agent.js';
import type { AcpToolInputPaths } from '../acp-base/tool-paths.js';
import { ANTIGRAVITY_API_KEY_METHOD_ID, ANTIGRAVITY_DESCRIPTOR, ANTIGRAVITY_MODE_IDS, GEMINI_API_KEY_ENV } from '../setup-antigravity/descriptor.js';
import { pinnedServer } from '../setup-antigravity/layout.js';

/** How long its server may take to start and open a session (Windows: about 17 s per process, spike 6.1). */
export const ANTIGRAVITY_START_TIMEOUT_MS = 120_000;

/**
 * Input fields that name a file or folder in its tools: Gemini-style
 * (`file_path`, `absolute_path`, `dir_path`) and Antigravity-style
 * (`TargetFile`, `AbsolutePath`, ...). Naming more paths only narrows what a
 * rule may answer. Live check 2 records the real ones.
 */
const TOOL_INPUT_PATHS: AcpToolInputPaths = {
  pathFields: ['file_path', 'absolute_path', 'path', 'dir_path', 'TargetFile', 'AbsolutePath', 'DirectoryPath', 'SearchPath', 'SearchDirectory', 'Cwd'],
  patternFields: ['pattern', 'glob', 'Pattern'],
};

/** Raw-input fields of its shell tools that hold the command. */
const COMMAND_FIELDS = ['command', 'CommandLine'] as const;

/** How to start its server: a program by absolute path and its arguments. */
export interface AntigravityServerCommand {
  command: string;
  args: readonly string[];
}

export interface AntigravityAgentOptions {
  /** The Ogden Agents data folder, where the pinned server is found. */
  dataDir: string;
  /**
   * The server to run, asked at each start (tests: Node and the fake agent).
   * Default: the pinned copy in {@link dataDir}; `undefined` from it means
   * not installed.
   */
  server?: (() => AntigravityServerCommand | undefined) | undefined;
  /** Called with protocol notes, for the log. Never includes the environment. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
  /** Default {@link ANTIGRAVITY_START_TIMEOUT_MS}. */
  startTimeoutMs?: number;
}

export function createAntigravityAgent(options: AntigravityAgentOptions): AgentPort {
  const reasons = acpReasons(ANTIGRAVITY_DESCRIPTOR.displayName);
  const quirks: AcpAgentQuirks = {
    launch() {
      const server = options.server === undefined ? pinnedServer(options.dataDir) : options.server();
      if (server === undefined) throw new AgentError('agent_unavailable', reasons.notSetUp);
      return { command: server.command, args: [...server.args], logFields: { server: server.command } };
    },
    // No `sessionMeta`: it has no per-session guard settings, so core never offers it Auto (it declares none anyway).
    toolInputPaths: TOOL_INPUT_PATHS,
    askingModeIds: [ANTIGRAVITY_MODE_IDS.ask],
    commandFields: COMMAND_FIELDS,
    // A key core put in its environment is chosen as its sign-in method; without one, its stored sign-in is used as it is.
    authMethod: ({ env }) => ((env[GEMINI_API_KEY_ENV] ?? '') === '' ? undefined : ANTIGRAVITY_API_KEY_METHOD_ID),
    // Its skills live in `.agents/skills` and run as slash commands, as bmad-loop's `agy` profile sends them
    // (entry 8); that its ACP server runs them is the user's live check 6 (spike 6.1).
    skillInvocation: slashSkillInvocation,
  };
  return createAcpAgent(ANTIGRAVITY_DESCRIPTOR, quirks, {
    onDiagnostic: options.onDiagnostic,
    startTimeoutMs: options.startTimeoutMs ?? ANTIGRAVITY_START_TIMEOUT_MS,
  });
}
