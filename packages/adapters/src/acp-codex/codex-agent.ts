/**
 * `acp-codex` (epic 12 entry 5, E12-R2): core's `AgentPort` for OpenAI's
 * Codex, through the pinned `codex-acp` adapter (2.1.1, with the Codex CLI
 * 0.159.3 it bundles), on the shared ACP client (`acp-base`). What is
 * Codex's own, from spike 12.1 and the pinned source:
 *
 * - It runs the adapter by its entry script under Ogden's own Node, the pinned
 *   copy `setup-codex` installed in the data folder, with core's environment:
 *   its `CODEX_HOME` and, under core's precedence rule, `CODEX_API_KEY`.
 *   `CODEX_PATH` is never set, so the adapter starts its own bundled Codex.
 * - Codex is API key only (user decision, 2026-10-05): with a key in its
 *   environment the client authenticates with `api-key` before opening a
 *   session; without one it opens sessions as they are and Codex's refusal
 *   (`-32000`) is `auth_required`. ChatGPT sign-in is never offered.
 * - `INITIAL_AGENT_MODE=read-only` starts every session in Ask, because the
 *   adapter's own default is Auto review. Ask is `read-only`, Skip all is
 *   `agent-full-access`. Auto (`agent`) is NOT offered: its review asks only
 *   about actions Codex judges unsafe, and nothing at launch or at session
 *   start makes it ask before writing Ogden's protected paths (`.claude`,
 *   `.mcp.json`, `CLAUDE.md`), which the user's decision (2026-10-04) requires.
 *   `workspace-write` is never offered: it asks less than Ask, so a switch to it
 *   (or to anything but `read-only`) drops the chat to Ask.
 * - Cards: Allow once picks the `allow_once` option. Deny picks `decline`,
 *   never `cancel`, `allow_always` or an amendment; a file change offers only
 *   `cancel` (kind `reject_once` in 2.1.1's `fileChangeDecisionOptions`) as its rejection, which Deny then picks (it ends the turn).
 * - It reopens with `session/resume`, else `session/load`, else core's
 *   stored-transcript fallback. There is no terminal resume: whether
 *   `codex resume <id>` takes the ACP session id is a live check, so the
 *   toggle reports `agent_unsupported`.
 * - Its home gets `config.toml` (`ephemeral` credential store, plugins off):
 *   the key never reaches `auth.json` and OpenAI's plugins repository is never
 *   downloaded (`config.ts`).
 */
import { AgentError, type AgentPort } from '@ogden-agents/core';
import { acpReasons, createAcpAgent, type AcpAgentQuirks } from '../acp-base/acp-agent.js';
import type { AcpToolInputPaths } from '../acp-base/tool-paths.js';
import { CODEX_DESCRIPTOR } from '../setup-codex/descriptor.js';
import { installedCodex } from '../setup-codex/install.js';
import { ensureCodexConfig } from './config.js';
import { CODEX_API_KEY_ENV, CODEX_AUTH_METHOD_IDS, CODEX_HOME_ENV, CODEX_INITIAL_MODE_ENV, CODEX_MODE_IDS, CODEX_OPTION_IDS, OPENAI_API_KEY_ENV } from './constants.js';

/**
 * Input fields that name a path in its tools. Its permission requests carry
 * the paths in `locations` (edits and commands), which the shared client reads
 * first; these only narrow what a rule may answer.
 */
const TOOL_INPUT_PATHS: AcpToolInputPaths = { pathFields: ['path', 'file_path'], patternFields: [] };

/** How to start the adapter: a program by absolute path and its arguments. */
export interface CodexServerCommand {
  command: string;
  args: readonly string[];
}

export interface CodexAgentOptions {
  /** The Ogden Agents data folder, where the pinned adapter is found. */
  dataDir: string;
  /**
   * The adapter to run, asked at each start (tests: Node and the fake agent).
   * Default: the pinned copy in {@link dataDir} under this Node; `undefined`
   * from it means not installed.
   */
  server?: (() => CodexServerCommand | undefined) | undefined;
  /**
   * Whether an unattended build may start Codex with its own sandbox (epic 17). Default
   * {@link CODEX_UNATTENDED_VERIFIED}: off until the user's live checks (RELEASING.md) show the
   * sandbox keeps the protected paths and lets a commit through; a test turns it on.
   */
  unattendedVerified?: boolean | undefined;
  /** Called with protocol notes, for the log. Never includes the environment. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * Codex's own sandbox for an unattended build is not yet known to keep Ogden's protected paths out of reach
 * of its edits inside the worktree (in `workspace-write` an edit in the workspace asks nothing, so core's rule never
 * sees it) or to let a `git commit` through (spike 17.1, live checks 1 to 3). Until the user's checks show both, an
 * unattended Codex build is refused and Codex builds with the user watching (user decision 2026-10-06).
 */
export const CODEX_UNATTENDED_VERIFIED = false;

/** The Build picker's line for Codex while its own sandbox is not verified here (plain words, no dashes). */
export const CODEX_ATTENDED_ONLY_REASON = "Codex's own sandbox hasn't been checked on this computer yet, so it builds with you watching.";

const hasKey = (env: Readonly<Record<string, string>>) => [CODEX_API_KEY_ENV, OPENAI_API_KEY_ENV].some((name) => (env[name] ?? '') !== '');

export function createCodexAgent(options: CodexAgentOptions): AgentPort {
  const reasons = acpReasons(CODEX_DESCRIPTOR.displayName, { apiKeyOnly: true });
  const quirks: AcpAgentQuirks = {
    launch({ env }) {
      let server: CodexServerCommand | undefined;
      if (options.server !== undefined) server = options.server();
      else {
        const installed = installedCodex(options.dataDir);
        if (installed !== undefined) server = { command: process.execPath, args: [installed.path] };
      }
      if (server === undefined) throw new AgentError('agent_unavailable', reasons.notSetUp);
      // Without its own home Codex would use `~/.codex`: keep the key in a file there and download plugins. Never started so.
      const home = env[CODEX_HOME_ENV];
      if (home === undefined || home === '') throw new AgentError('agent_unavailable', reasons.couldNotStart);
      try {
        ensureCodexConfig(home);
      } catch {
        // Without its config Codex would keep the key in a file and download plugins: not started.
        throw new AgentError('agent_unavailable', reasons.couldNotStart);
      }
      return {
        command: server.command,
        args: [...server.args],
        // Ask first: the adapter's own default is Auto review. `CODEX_PATH` is never set.
        addEnv: { [CODEX_INITIAL_MODE_ENV]: CODEX_MODE_IDS.ask },
        logFields: { server: server.command },
      };
    },
    // An unattended build (epic 17): `workspace-write` with only the run's roots writable, as the adapter's own
    // start mode and the session's additional directories (the sandbox follows the mode and allows no network,
    // 2.1.1 source). Refused unless verified; core's policy answers every request that still reaches it.
    buildSession: {
      verified: options.unattendedVerified ?? CODEX_UNATTENDED_VERIFIED,
      start: (sandbox) => {
        // Nothing writable means nothing to give: a wiring bug, never a start with Codex's own defaults.
        if (sandbox.writableRoots.length === 0) throw new Error('a build sandbox has no writable root');
        return {
          addEnv: { [CODEX_INITIAL_MODE_ENV]: CODEX_MODE_IDS.workspaceWrite },
          sessionParams: { additionalDirectories: [...sandbox.writableRoots] },
          modeIds: [CODEX_MODE_IDS.workspaceWrite],
        };
      },
    },
    // Until the live checks show its sandbox holds, a build is with the user watching, and the picker says so in these words.
    ...((options.unattendedVerified ?? CODEX_UNATTENDED_VERIFIED) ? {} : { attendedOnlyReason: CODEX_ATTENDED_ONLY_REASON }),
    toolInputPaths: TOOL_INPUT_PATHS,
    // Only `read-only` asks as much as Ask: `workspace-write` and `agent` ask less, so core tells it Ask.
    askingModeIds: [CODEX_MODE_IDS.ask],
    commandFields: ['command'],
    // A key core put in its environment is the only sign-in there is (Codex is API key only); without one, sessions open as they are.
    authMethod: ({ env }) => (hasKey(env) ? CODEX_AUTH_METHOD_IDS.apiKey : undefined),
    // Deny is `decline` (a command); a file change offers only `cancel`, which Deny then takes.
    rejectOptionIds: [CODEX_OPTION_IDS.decline, CODEX_OPTION_IDS.cancel],
    // Its skills live in `.agents/skills` and run as `$name` (entry 9).
    skillInvocation: (skill, idea) => (idea === undefined || idea === '' ? `$${skill}` : `$${skill} ${idea}`),
  };
  return createAcpAgent(CODEX_DESCRIPTOR, quirks, { onDiagnostic: options.onDiagnostic });
}
