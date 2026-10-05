/**
 * `acp-grok` (epic 12 entry 7, E12-R3): core's `AgentPort` for xAI's Grok,
 * through its own `grok agent stdio` (spike 12.2, 1.0.49), on the shared ACP
 * client (`acp-base`). What is Grok's own:
 *
 * - It runs Ogden's own checked binary (`setup-grok` unpacked it and checked
 *   its SHA-256), never npm's launcher or `~/.grok/bin`, as `grok agent
 *   --no-leader stdio` with core's environment: its `GROK_HOME` in the data
 *   folder and, under core's precedence rule, `XAI_API_KEY`. `launch` adds
 *   `GROK_DISABLE_AUTOUPDATER=1` (the binary Ogden checked is the one that runs)
 *   and `GROK_FOLDER_TRUST=0`: Grok's own folder trust silently skips a project's
 *   hooks, MCP servers, skills and permission rules until a folder is in its
 *   trust store (probed on 1.0.49), and Ogden's own per-project trust has
 *   already been given before this chat starts (`needsProjectTrust`), so
 *   without it the BMad skills Planning puts in the project would never reach Grok.
 * - Grok is an xAI API access token only (user decision, 2026-10-05): with a
 *   token in its environment the client authenticates with the unadvertised
 *   `xai.api_key` before opening a session; without one it opens sessions as
 *   they are and Grok's refusal (`-32000`) is `auth_required`. Its advertised
 *   `grok.com` (an account sign in) is never called.
 * - Grok has no session modes: the chat's mode is given once, in the `_meta`
 *   of `session/new`, `resume` and `load` (`modeFixedAtStart`). Ask is
 *   explicit (`yoloMode` and `autoMode` both false, so nothing the project
 *   says loosens it: probed on 1.0.49, a project whose `.claude/settings.json`
 *   says `bypassPermissions` still opened with `yolo` false), Skip all is
 *   `yoloMode`. Auto (`autoMode`) is NOT offered: Grok's classifier asks only
 *   about calls it won't allow and fails them in an unidentified stdio session,
 *   and nothing at start makes it ask before writing Ogden's protected paths
 *   (`.claude`, `.mcp.json`, `CLAUDE.md`, `.grok`), which the user's decision
 *   (2026-10-04) requires. Core refuses a mid-chat change.
 * - Cards: Allow once is the `allow_once` option and Deny the first
 *   `reject_once` one (the shared client never picks an always option).
 * - It reopens with `session/resume`, else `session/load`, else core's
 *   stored-transcript fallback. There is no terminal resume: whether
 *   `grok --resume <id>` takes the ACP session id is a live check, so the
 *   toggle reports `agent_unsupported`.
 * - BMad skills run as a slash command (`/name idea`): with Grok's folder
 *   trust off it lists `.claude/skills` as commands (probed).
 */
import { AgentError, type AgentPort } from '@ogden-agents/core';
import { acpReasons, createAcpAgent, type AcpAgentQuirks } from '../acp-base/acp-agent.js';
import { slashSkillInvocation } from '../acp-base/quirks.js';
import type { AcpToolInputPaths } from '../acp-base/tool-paths.js';
import { GROK_DESCRIPTOR } from '../setup-grok/descriptor.js';
import { installedGrok } from '../setup-grok/install.js';
import {
  GROK_API_KEY_ENV,
  GROK_AUTH_METHOD_IDS,
  GROK_DISABLE_AUTOUPDATER_ENV,
  GROK_FOLDER_TRUST_ENV,
  GROK_HOME_ENV,
} from './constants.js';

/**
 * Input fields that name a path in its tools. Not observed without a model turn (a live check): these are the common
 * names; they only narrow what a rule may answer, since the shared client reads `locations` first.
 */
const TOOL_INPUT_PATHS: AcpToolInputPaths = { pathFields: ['path', 'file_path', 'filePath'], patternFields: [] };

/** How to start Grok: a program by absolute path and its arguments. */
export interface GrokServerCommand {
  command: string;
  args: readonly string[];
}

/** The arguments of the real binary: the agent, never joining a shared leader process, over stdio. */
export const GROK_ARGS: readonly string[] = ['agent', '--no-leader', 'stdio'];

export interface GrokAgentOptions {
  /** The Ogden Agents data folder, where the checked binary is found. */
  dataDir: string;
  /**
   * What to run, asked at each start (tests: Node and the fake agent). Default: the checked
   * binary in {@link dataDir} with {@link GROK_ARGS}; `undefined` from it means not installed.
   */
  server?: (() => GrokServerCommand | undefined) | undefined;
  /** Called with protocol notes, for the log. Never includes the environment. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}

// `xai.api_key` reads `XAI_API_KEY` (core sets only that one); the other name is kept out of every process.
const hasKey = (env: Readonly<Record<string, string>>) => (env[GROK_API_KEY_ENV] ?? '') !== '';

export function createGrokAgent(options: GrokAgentOptions): AgentPort {
  const reasons = acpReasons(GROK_DESCRIPTOR.displayName, { apiKeyOnly: true, keyName: 'xAI API access token' });
  const quirks: AcpAgentQuirks = {
    launch({ env }) {
      let server: GrokServerCommand | undefined;
      if (options.server !== undefined) server = options.server();
      else {
        const installed = installedGrok(options.dataDir);
        if (installed !== undefined) server = { command: installed.path, args: GROK_ARGS };
      }
      if (server === undefined) throw new AgentError('agent_unavailable', reasons.notSetUp);
      // Without its own home Grok would use `~/.grok` (its sign in, sessions and logs, and `~/.grok/bin`'s own copy): never started so.
      const home = env[GROK_HOME_ENV];
      if (home === undefined || home === '') throw new AgentError('agent_unavailable', reasons.couldNotStart);
      return {
        command: server.command,
        args: [...server.args],
        addEnv: { [GROK_DISABLE_AUTOUPDATER_ENV]: '1', [GROK_FOLDER_TRUST_ENV]: '0' },
        logFields: { server: server.command },
      };
    },
    toolInputPaths: TOOL_INPUT_PATHS,
    // No session modes: only a mode Grok started in exists, so nothing asks less than Ask behind core's back.
    askingModeIds: [GROK_DESCRIPTOR.permissionModes.ask],
    // A token core put in its environment is the only sign in there is; without one, sessions open as they are.
    authMethod: ({ env }) => (hasKey(env) ? GROK_AUTH_METHOD_IDS.apiKey : undefined),
    // The chat's mode, once, at every start, reopen and load. Ask is explicit so a project's own settings never loosen it.
    startOptions: ({ permissionMode }) => ({
      meta: permissionMode === 'skip_all' ? { yoloMode: true } : { yoloMode: false, autoMode: false },
      guardsPaths: false,
    }),
    commandFields: ['command', 'cmd'],
    skillInvocation: slashSkillInvocation,
  };
  return createAcpAgent(GROK_DESCRIPTOR, quirks, { onDiagnostic: options.onDiagnostic });
}
