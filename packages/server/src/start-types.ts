/**
 * The server's start options and what a started server is (moved from
 * `start.ts`, story 3.9).
 */
import type { ClaudeCodeSetupOptions, FetchLike, PtyLoader } from '@ogden-agents/adapters';
import type { AgentWiring } from './agent-wiring.js';
import type { AntigravityPorts } from './antigravity-wiring.js';
import type { AgentApiKeySupport, AgentPort, AgentSetupPort, AppShortcutPort, BmadCatalogPort, BmadSourcePort, Core, SandboxPort, SecretStorePort, TicketStorePort, ToolchainPort, VcsPort } from '@ogden-agents/core';
import type { BmadPiece } from '@ogden-agents/shared';
import type { Clock, TabTokens } from './auth.js';
import type { Logger } from './log.js';
import type { UpdatesOption } from './update-check.js';

export interface StartOptions {
  /** Port to try first. `0` asks the OS for any free port. Default `DEFAULT_PORT` (4317). */
  port?: number;
  /** Open the default browser at the single-use launch URL (`launchUrl`); implies `launch`. Default `false`. */
  open?: boolean;
  /**
   * Issue a single-use launch link as the server starts (`launchUrl`), for
   * `--foreground`, which prints it, and tests. Default `false`: the
   * background server issues codes only on request (the launcher's
   * `/launcher/hello?launch=1`, New tab), so none goes unused.
   */
  launch?: boolean;
  /** Override the built UI directory. */
  webRoot?: string;
  /**
   * The data folder for the database and logs, created readable only by the
   * user if missing. Default: the per-user data directory, or
   * `$OGDEN_AGENTS_DATA_DIR` (see `ensureDataDir`).
   */
  dataDir?: string;
  /** Use this already-open core instead of opening one in `dataDir` (tests). The caller closes it. */
  core?: Core;
  /** Override the logger (tests). Default: stderr plus a rotating file in `<dataDir>/logs`. */
  log?: Logger;
  /** Override the clock for launch code and tab token expiry (tests). Default `Date.now`. */
  now?: Clock;
  /**
   * Override how `uv` is found and installed (tests). Default: the
   * `toolchain-uv` adapter on `dataDir`, which downloads only when the user
   * clicks Install.
   */
  toolchain?: ToolchainPort;
  /** Override Claude Code's chat agent (tests). Default: the `acp-claude-code` adapter. */
  agent?: AgentPort;
  /**
   * More agents a chat can be started with, after Claude Code (epic 6; tests:
   * the fake ACP agent as a second agent). Never set by the launcher: a
   * shipped install has Claude Code only until another agent's adapter ships.
   * Each runs with its own environment rules, its id's API key only, and
   * its setup port (if any) decides whether a new chat with it is refused (6.3).
   */
  extraAgents?: readonly AgentWiring[];
  /**
   * Antigravity (epic 6 entry 5), registered after Claude Code: by default
   * its own adapters on the data folder (a pinned copy found there, a
   * Gemini API key); a test gives ports in their place (the fake agent's
   * Antigravity personality), or `false` to leave it out.
   */
  antigravity?: false | AntigravityPorts;
  /**
   * The Claude Agent ACP adapter's entry script (or, in tests, any script
   * that speaks ACP over stdio, such as the fake agent). Default:
   * `$OGDEN_AGENTS_CLAUDE_ACP_PATH`, else the adapter in `node_modules` if
   * this is a dev install, else the one Install put in the data folder,
   * looked for at each chat start and status (story 9.3).
   */
  claudeAdapterPath?: string | undefined;
  /**
   * Installing Claude Code (story 9.3): the pins, npm and its runner (tests: a
   * local fixture lock, the test's npm, a slowed runner), and `devAdapter:
   * false` to ignore a dev install's `node_modules` adapter, so only the data
   * folder's counts. Default: the pinned adapter, npm beside this Node.
   */
  claudeInstall?: NonNullable<ClaudeCodeSetupOptions['install']> & { devAdapter?: boolean };
  /**
   * The user's own `claude` for Claude Code (tests: `null`, none). Default:
   * one found on `PATH` or at Claude Code's install locations.
   */
  claudeExecutable?: string | null;
  /**
   * How long a `working` agent may be silent before core checks in (story
   * 2.10). Default: `$OGDEN_AGENTS_TEST_CHECK_IN_MS` if set and test hooks
   * are allowed (a test run, `NODE_ENV=test` or `VITEST`, on a data folder
   * inside the OS temp folder), else 10 minutes.
   */
  checkInDelayMs?: number;
  /** Variables added to every agent's environment on top of `agentEnvironment` (tests: the fake agent's switches). */
  extraAgentEnv?: Readonly<Record<string, string>>;
  /**
   * Installing and signing into each agent. Default: the `setup-claude-code`
   * adapter, which finds the Claude Agent ACP adapter (see
   * {@link claudeAdapterPath}) or installs it into the data folder.
   */
  agentSetup?: readonly AgentSetupPort[];
  /** Loads `node-pty` for the hidden sign-in terminal (tests: one that fails, AD-19). Default: `terminal-pty`'s lazy loader. */
  loadPty?: PtyLoader;
  /**
   * A `BROWSER` value that stops the Claude CLI opening its own sign-in tab,
   * so the page opens it. Unset by default until the live check proves one
   * works (story 9.1): the CLI opens its tab and the page shows a link.
   */
  claudeCliBrowser?: string;
  /**
   * Where API keys are kept (AD-16). Default: the OS keychain
   * (`secrets-keyring`), or memory when `$OGDEN_AGENTS_TEST_SECRET_STORE` is
   * `memory`. Tests pass `secrets-memory`: none touches the real keychain.
   */
  secrets?: SecretStorePort;
  /** Replaces Claude Code's API key check (tests: a stub, so none reaches Anthropic). Default: the real `GET /v1/models`. */
  verifyApiKey?: AgentApiKeySupport['verify'];
  /** How old the subscription state may be when a chat starts before it is read again. Default `SUBSCRIPTION_MAX_AGE_MS`. */
  subscriptionMaxAgeMs?: number;
  /**
   * This install's launcher, `bin/ogden.js`, for the app shortcut to run
   * (E2-R10). With it, the default {@link appShortcut} is the `shortcut-os`
   * adapter, and a shortcut already there is re-pointed at this Node and
   * launcher once the server is up (never created). Without it (tests), the
   * in-memory `shortcut-memory` stub.
   */
  launcherEntry?: string;
  /** Override the app shortcut (tests). Default: see {@link launcherEntry}. */
  appShortcut?: AppShortcutPort;
  /**
   * BMad pieces to report as available on top of `SHIPPED_BMAD_PIECES`
   * (story 10.2), so a test can turn on a piece no epic ships yet. The
   * launcher never sets it. Ignored when {@link core} is given: that core
   * already has its own list.
   */
  availableBmadPieces?: readonly BmadPiece[];
  /**
   * Override the read-only BMad detection (story 10.3) and the catalog's
   * skills (story 4.1). Default: the `bmad-catalog` adapter. With {@link core}
   * given, only the skills come from it.
   */
  bmadCatalog?: BmadCatalogPort;
  /**
   * Override the project's tickets (story 4.1; tests: a stub). Default: the
   * `tickets-v7` adapter, running the verified pinned `tickets.py` with `uv`.
   */
  ticketStore?: TicketStorePort;
  /**
   * Override the pinned upstream BMad Method (story 4.14, AD-13; tests: the
   * `bmad-source-memory` stub, or the real adapter on a fixture lock).
   * Default: the `bmad-source` adapter on `dataDir`, which downloads only
   * when the user asks (`POST /api/v1/bmad/source`).
   */
  bmadSource?: BmadSourcePort;
  /**
   * The `fetch` the default {@link bmadSource} downloads with (tests only: a
   * counting or failing stub, so no test reaches GitHub). Ignored when
   * {@link bmadSource} is given. The launcher never sets it.
   */
  bmadFetch?: FetchLike;
  /**
   * Variables added to the environment of every `uv` child (the version
   * probe and every BMad Method script run; story 4.2), on top of
   * `uvEnvironment` (tests only: a temp `UV_CACHE_DIR`, the uv-managed test
   * Python with no download). The launcher never sets it.
   */
  extraUvEnv?: Readonly<Record<string, string>>;
  /**
   * Override the sandbox check unattended builds make (story 5.2; tests: a
   * fixed answer). Default: the `sandbox-claude-native` adapter, or the
   * `OGDEN_AGENTS_TEST_SANDBOX` hook's answer on a test run.
   */
  sandbox?: SandboxPort;
  /** Override git for unattended builds (story 5.2; tests). Default: the `vcs-git` adapter on the user's `git`. */
  vcs?: VcsPort;
  /**
   * The "newer version" check (story 13.7): `false` turns it off, a client
   * replaces the real npm one (tests: a fake, so none reaches the network).
   * Default: the real `fetch`, except `OGDEN_AGENTS_OFFLINE` is set or this is
   * a test run, which never makes a request.
   */
  updates?: UpdatesOption;
  /**
   * Called once the server has stopped by itself (Quit, or a restart the
   * launcher asked for) and everything is closed. A server process exits here.
   */
  onStop?: (reason: StopReason) => void;
}

/**
 * Why the server stopped: `quit` from the UI, `restart` for a newer version
 * (the launcher starts it), or `close` from its owner.
 */
export type StopReason = 'quit' | 'restart' | 'close';

/** The contents of the port file `<dataDir>/server.json` (AD-15). */
export interface PortFile {
  port: number;
  pid: number;
  version: string;
  /** ISO 8601 UTC. */
  startedAt: string;
}

export interface RunningServer {
  /** The base URL. A tab opened on it without a token shows how to get in. */
  url: string;
  /**
   * `<url>/#c=…`: a single-use link, valid for 60 seconds, that opens one
   * connected tab (AD-15: the page exchanges the code for its token over
   * POST), issued at start only with `launch` or `open`. It is a secret:
   * print it for the user, never log it.
   */
  launchUrl: string | undefined;
  port: number;
  version: string;
  /** The data folder in use. */
  dataDir: string;
  /** Core as wired into this server: the event log and entity model. */
  core: Core;
  /** The live tab tokens (in memory only; gone when the server stops). */
  tabs: TabTokens;
  /** A fresh single-use launch link, as `launchUrl`. A secret: never log it. */
  issueLaunchUrl(): string;
  /** Resolves once the server has stopped, however it stopped, with the reason. */
  stopped: Promise<StopReason>;
  /**
   * Stops the server: closes the port and the sockets, removes `server.json`
   * and `launcher.token`, and closes core if the server opened it. Safe to call
   * more than once.
   */
  close(): Promise<void>;
}
