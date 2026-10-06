/**
 * `acp-opencode` (epic 14, story 14.2, E14-R1): core's `AgentPort` for the
 * Local model, through the pinned OpenCode's `opencode acp` (spike 14.1,
 * 1.18.34), on the shared ACP client (`acp-base`). What is its own:
 *
 * - It runs Ogden's own checked binary (`setup-local` unpacked it and checked
 *   its SHA-256), never one on `PATH`, as `opencode acp` with core's
 *   environment plus the config, folders and key the wiring adds
 *   (`opencodeChatEnv`) and the network switches this launch adds. The launch
 *   refuses to start the harness when its home, config or `XDG_*` folders are
 *   not Ogden's own in the data folder (fail closed), so the user's own
 *   `~/.claude/skills`, config or repo config are never read.
 * - No account, no key at the agent: `authenticate` is never called
 *   (spike 14.1: its one method, `opencode-login`, is never needed). An
 *   endpoint's key reaches it only as `OGDEN_ENDPOINT_KEY`, referenced by the
 *   generated config.
 * - Its mode is Ask only and fixed at start (`modeFixedAtStart`): the
 *   generated config makes every tool that runs, writes or reaches out ask,
 *   and its own `plan` mode (still able to run commands) is never offered.
 * - Cards: Allow once is the `allow_once` option and Deny the first
 *   `reject_once` one (the shared client never picks `allow_always`, which
 *   the harness widens to every command of the same shape).
 * - Its models are the ones Ogden wrote into the config (the harness never
 *   asks the server): it lists them as the session's `model` option, so the
 *   model picker (story 11) switches them live.
 * - It reopens with `session/resume`, else `session/load`, else core's
 *   stored-transcript fallback. There is no terminal resume yet (story 14.7).
 * - BMad skills run as a slash command (`/name idea`), from `.agents/skills`.
 */
import { AgentError, type AgentPort } from '@ogden-agents/core';
import { acpReasons, createAcpAgent, type AcpAgentQuirks } from '../acp-base/acp-agent.js';
import { slashSkillInvocation } from '../acp-base/quirks.js';
import type { AcpToolInputPaths } from '../acp-base/tool-paths.js';
import { LOCAL_DESCRIPTOR } from '../setup-local/descriptor.js';
import { installedOpenCode } from '../setup-local/layout.js';
import { opencodeEnvProblems } from './config.js';
import { LOCAL, LOCAL_MODE_IDS, OPENCODE_SWITCHES } from './constants.js';

/** Input fields that name a path in its tools (spike 14.1: `filePath` for read, edit and write; `path` for a search's folder). */
const TOOL_INPUT_PATHS: AcpToolInputPaths = { pathFields: ['filePath', 'path', 'file_path'], patternFields: ['pattern'] };

/** How to start the harness: a program by absolute path and its arguments. */
export interface LocalServerCommand {
  command: string;
  args: readonly string[];
}

export interface LocalAgentOptions {
  /** The Ogden Agents data folder, where the checked binary is found. */
  dataDir: string;
  /**
   * What to run, asked at each start (tests: Node and the fake agent). Default: the checked
   * binary in {@link dataDir} with `acp`; `undefined` from it means not installed.
   */
  server?: (() => LocalServerCommand | undefined) | undefined;
  /** Called with protocol notes, for the log. Never includes the environment. */
  onDiagnostic?: ((message: string, fields?: Record<string, unknown>) => void) | undefined;
}

export function createLocalAgent(options: LocalAgentOptions): AgentPort {
  const reasons = acpReasons(LOCAL_DESCRIPTOR.displayName);
  const diagnostic = (message: string, fields?: Record<string, unknown>) => {
    try {
      options.onDiagnostic?.(message, fields);
    } catch {
      // Logging never breaks a start.
    }
  };
  const quirks: AcpAgentQuirks = {
    launch({ env }) {
      let server: LocalServerCommand | undefined;
      if (options.server !== undefined) server = options.server();
      else {
        const installed = installedOpenCode(options.dataDir);
        if (installed !== undefined) server = { command: installed.command, args: installed.args };
      }
      if (server === undefined) throw new AgentError('agent_unavailable', reasons.notSetUp);
      // Never started on the user's own home, config or caches: only the folders Ogden gave it.
      const problems = opencodeEnvProblems(env, options.dataDir);
      if (problems.length > 0) {
        diagnostic('the Local model was not started: its folders are not set', { problems });
        throw new AgentError('agent_unavailable', reasons.couldNotStart);
      }
      return { command: server.command, args: [...server.args], addEnv: { ...OPENCODE_SWITCHES }, logFields: { server: server.command } };
    },
    toolInputPaths: TOOL_INPUT_PATHS,
    // One mode: the session always runs as `build`, asking before every tool that runs or writes.
    askingModeIds: [LOCAL_MODE_IDS.ask],
    // No `authenticate`: the harness opens sessions with no account and no key.
    authMethod: () => undefined,
    // The chat's mode, once: Ask is all it has, so there is nothing to send.
    startOptions: () => ({ guardsPaths: false }),
    commandFields: ['command'],
    skillInvocation: slashSkillInvocation,
  };
  return createAcpAgent(LOCAL_DESCRIPTOR, quirks, { onDiagnostic: options.onDiagnostic });
}
