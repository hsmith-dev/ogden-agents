/**
 * The chat use-case's types (moved from `chat.ts`, story 3.11): the public
 * `ChatOptions`, `TerminalViewer` and `Chat`, and the state the chat modules
 * share by reference (`Live`, `Terminal`, `Turn`).
 */
import type { AgentId, ChatAgent, PermissionMode, Session, SessionDriver, SessionId, SessionKind, SessionPermissionModeOption, ToolCallDiff, ToolCallStatus, ToolKind, Workspace, WorkspaceId } from '@ogden-agents/shared';
import type { AgentError, AgentRegistry, AgentSession } from '../agent-port.js';
import type { AgentReadiness } from '../agent-setup-types.js';
import type { Entities, NewWorkspaceOptions } from '../entities.js';
import type { EventLog, HistoryDeleted } from '../event-log.js';
import type { InstallSettings } from '../install-settings.js';
import type { Permissions } from '../permissions.js';
import type { SessionEvents } from '../session-events.js';
import type { TerminalPort, TerminalProcess } from '../terminal-port.js';

export interface ChatOptions {
  entities: Entities;
  /**
   * Ogden Agents' own data folder: never a workspace, nor inside or above
   * one, so an agent can't be pointed at the database, logs or tokens.
   */
  dataDir: string;
  sessionEvents: SessionEvents;
  /**
   * The agents chats can be started with (epic 6): each session's agent is
   * looked up here by its `agentId` (sessions without one are the registry's
   * `legacyAgentId`). Core names no agent.
   */
  agents: AgentRegistry;
  /**
   * Answers the agents' permission requests. Default: the declining stub
   * (`createDecliningPermissions`), which denies every request.
   */
  permissions?: Permissions;
  /**
   * The environment the agent `agentId`'s processes get (AD-16: API keys go
   * here and nowhere else, each agent's only to its own). Called for every
   * agent start. Default: none.
   */
  agentEnv?: (agentId: AgentId) => Readonly<Record<string, string>>;
  /** Called with every agent failure, for the log. Its `details` hold no secret. */
  onAgentError?: (sessionId: SessionId, error: AgentError) => void;
  /**
   * Called once when a tool call turns `completed` (story 4.7: core's
   * document detection), after its event, with its diffs (each side capped).
   * A throw is caught: it never changes the session.
   */
  onToolCallCompleted?: (sessionId: SessionId, toolCallId: string, diffs: readonly ToolCallDiff[] | undefined) => void;
  /** Called when applying an agent's event failed (such as a session deleted mid-reply), for the log. */
  onInternalError?: (sessionId: SessionId, error: unknown) => void;
  /** How long a `working` agent may be silent before core checks in, clamped by `clampCheckInDelay`. Default `DEFAULT_CHECK_IN_MS`. */
  checkInDelayMs?: number;
  /** How long Stop waits for the turn to end before dropping the agent. Default `STOP_GRACE_MS`. */
  stopGraceMs?: number;
  /** Opens the agent's own CLI in a terminal (story 3.1). Without it, switching to the terminal is refused. */
  terminal?: TerminalPort;
  /**
   * The event log, which the chat follows (permission modes): each change of a
   * chat's stored mode is pushed to its live agent (or its terminal is handed
   * back when Developer mode was turned off). Without it, only the modes the
   * chat itself sets reach its agents.
   */
  events?: Pick<EventLog, 'subscribe' | 'lastSeq'>;
  /** Developer mode, which gates Skip all. Without it, Developer mode reads off. */
  installSettings?: Pick<InstallSettings, 'developerMode'>;
  /** How long an agent may take to take a permission mode before it is dropped. Default `PERMISSION_MODE_TIMEOUT_MS`. */
  permissionModeTimeoutMs?: number;
  /**
   * Whether a new chat can be started with `agentId` now (6.3; server wiring:
   * `AgentSetup.readiness`). Without it, every agent is ready. One that
   * throws counts as ready: "can't tell" never refuses a chat.
   */
  agentReadiness?: (agentId: AgentId) => Promise<AgentReadiness>;
  /**
   * Whether the user trusted the project (6.3; the per-project trust gate,
   * story 4.2, bound to the project's scripts since 4.13). A chat with an
   * agent whose descriptor `needsProjectTrust` is refused unless it says yes;
   * one that throws counts as no. Without it, no project is trusted.
   */
  projectTrusted?: (workspaceId: WorkspaceId) => boolean | Promise<boolean>;
}

/** A terminal's size in character cells. */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * One viewer's hold on a session's terminal (story 3.1). What it carries is
 * the user's content: never log, event or store it.
 *
 * Story 3.5: several viewers may hold the same terminal; each sees all its
 * output and may type. Each viewer has its own size (from {@link TerminalViewer.resize});
 * the terminal takes the size of whichever viewer last resized or typed
 * (epic decision), and the other viewers hear of it through {@link TerminalViewer.onSize}.
 */
export interface TerminalViewer {
  /**
   * The most recent output now, at most `TERMINAL_BACKLOG_CHARS`. Read
   * it in the same tick as subscribing with {@link TerminalViewer.onData}, so no output is
   * missed or repeated between them.
   */
  readonly backlog: string;
  /** The terminal's size now. */
  readonly size: TerminalSize;
  /** Everything the terminal prints from now on. Returns the unsubscribe. */
  onData(listener: (data: string) => void): () => void;
  /** Called once when the terminal ends: its CLI exited (`exitCode`), or the session switched back (`null`). Returns the unsubscribe. */
  onEnd(listener: (end: { exitCode: number | null }) => void): () => void;
  /**
   * The terminal's new size: another viewer resized it, or a viewer typed and
   * the terminal took that viewer's size (then every viewer is told, the
   * typer included). Returns the unsubscribe.
   */
  onSize(listener: (size: TerminalSize) => void): () => void;
  /** Types into the terminal, first giving it this viewer's size if it has one and the terminal is at another. */
  write(data: string): void;
  /**
   * Sets this viewer's size, clamped to `1..MAX_TERMINAL_COLS` ×
   * `1..MAX_TERMINAL_ROWS` (a non-finite one is ignored); the terminal takes
   * it, and the other viewers are told when it changed.
   */
  resize(cols: number, rows: number): void;
  /** Lets go of the terminal: its listeners are removed. The terminal runs on, with or without viewers. */
  detach(): void;
}

export interface Chat {
  /**
   * The workspace for the repo at `path`, created if new (AD-2). `path` must
   * be absolute (a leading `~` is the user's home). Throws
   * `InvalidOperationError` if it isn't, if it is not an existing
   * folder, or if it is, holds or sits inside Ogden Agents' data folder.
   * `options` apply only when the workspace is created (story 10.4).
   */
  openWorkspace(path: string, options?: NewWorkspaceOptions): Workspace;
  /** Every workspace of this install, oldest first. */
  listWorkspaces(): Workspace[];
  /** The workspace (`NotFoundError` if there is none). */
  getWorkspace(workspaceId: WorkspaceId): Workspace;
  /** The workspace's sessions, oldest first (`NotFoundError` for an unknown workspace). */
  listSessions(workspaceId: WorkspaceId): Session[];
  /**
   * Deletes the workspace's history: its events, sessions and runs; the
   * workspace and every other workspace stay. Throws
   * `WorkspaceBusyError`, deleting nothing, while one of its sessions is
   * `working` or `waiting` or its agent is still answering, and
   * `NotFoundError` for an unknown workspace. The deleted sessions'
   * idle agents are then stopped.
   */
  deleteHistory(workspaceId: WorkspaceId): Omit<HistoryDeleted, 'event'>;
  /**
   * A new session in the workspace, `idle`, with the agent `agentId` (the
   * registry's default when absent), fixed for its life (epic 6): a `chat`
   * by default, or a `planning` session (story 4.1), which is a chat whose
   * first message the planning use-case sends. Rejects, creating nothing,
   * with `NotFoundError` for an unknown workspace, `UnknownAgentError` for an
   * agent that isn't registered, and `AgentNotReadyError` (6.3) for one that
   * needs a project trust the project lacks, isn't installed, or isn't
   * signed in.
   */
  createChatSession(workspaceId: WorkspaceId, options?: { kind?: Exclude<SessionKind, 'build'> | undefined; agentId?: AgentId | undefined }): Promise<Session>;
  /**
   * The agents a chat can be started with, in order (epic 6; frozen in 6.3):
   * what each is, the permission modes it declares, its setup, and why a new
   * chat with it is refused now, if it is.
   */
  chatAgents(): Promise<{ agents: ChatAgent[]; defaultAgentId: AgentId }>;
  /** The session, which must belong to the workspace (`NotFoundError` otherwise). */
  getSession(workspaceId: WorkspaceId, sessionId: SessionId): Session;
  /**
   * Stores the user's message and hands it to the session's agent, starting
   * the agent first if needed. Returns once the message is stored; the reply
   * and the state follow through the event log. While the agent is still
   * answering, the message is queued (`queued: true`) and sent when the turn
   * ends. Throws `QueueFullError` when `MAX_QUEUED_MESSAGES` are
   * already queued, `SessionBusyError` while a failed turn is ending,
   * `DriverIsTerminalError` while the terminal drives the session (AD-6),
   * and `SessionNotIdleError` while it is switching drivers.
   */
  sendMessage(workspaceId: WorkspaceId, sessionId: SessionId, text: string): { messageId: string; queued: boolean };
  /**
   * Stop: asks the agent to cancel its running prompt, declines the pending
   * permission requests (the session leaves `waiting` for `idle`) and drops
   * the queued messages, which stay unsent. The session ends `idle`; an agent
   * that has not ended its turn within the grace period is dropped and the
   * session is `idle`, resumable. Throws `SessionNotBusyError` when no
   * turn is running and `NotFoundError` for an unknown session.
   */
  cancel(workspaceId: WorkspaceId, sessionId: SessionId): void;
  /**
   * Hands the session to `driver` (story 3.1, AD-6). To `terminal`: only
   * while the session is `idle`, with no turn or queue, and has reached its
   * agent; the agent's process is released and has exited before its CLI
   * opens on the same agent session. To `ui`: the CLI and its tree are
   * killed, then the turns typed in it are imported. Each change appends
   * `session.driver_changed` with its cause; asking for the current driver
   * changes nothing. Throws `SessionNotIdleError` or
   * `TerminalUnavailableError` with a plain reason (nothing changed)
   * and `NotFoundError` for an unknown session.
   */
  switchDriver(workspaceId: WorkspaceId, sessionId: SessionId, driver: SessionDriver): Promise<Session>;
  /** A hold on the session's running terminal, or `undefined` when the terminal does not drive it. */
  attachTerminal(sessionId: SessionId): TerminalViewer | undefined;
  /**
   * Sets the chat's permission mode (the user chose it): appends
   * `session.permission_mode_changed` (cause `user`) and tells its live
   * agent. The same mode again changes nothing. Refused, changing nothing:
   * `DriverIsTerminalError` while the terminal drives, `SessionNotIdleError`
   * while it switches drivers, for `skip_all` `DeveloperModeRequiredError`
   * (Developer mode off) and `ConfirmationRequiredError` (no `confirm`),
   * `ModeUnavailableError` for a mode the agent or its session doesn't
   * offer, `NotFoundError` for an unknown session.
   */
  setPermissionMode(workspaceId: WorkspaceId, sessionId: SessionId, mode: PermissionMode, options?: { confirm?: boolean | undefined }): Session;
  /** Every permission mode, in order, and whether the session's agent (and its session, when it has one this run) offers it. */
  permissionModeOptions(workspaceId: WorkspaceId, sessionId: SessionId): SessionPermissionModeOption[];
  /** Resolves once no agent turn is running (tests, shutdown). */
  settled(): Promise<void>;
  /**
   * Ends every agent session and stops their processes (AD-3: the server
   * owns them). Sessions still answering become `idle`, resumable, with
   * `RESTARTED_REASON`, before their agents stop.
   */
  close(): Promise<void>;
}

/** A tool call as core last recorded it: each event carries the whole call (diffs only when they change). */
export interface ToolCallState {
  title: string;
  kind: ToolKind;
  status: ToolCallStatus;
  diffs: ToolCallDiff[] | undefined;
}

export type Timer = ReturnType<typeof setTimeout>;

/** One session's live agent, and the reply it is writing, if any. */
export interface Live {
  agent: Promise<AgentSession>;
  reply: { messageId: string; text: string } | undefined;
  /** Reply text received but not yet appended as a delta (coalesced). */
  pendingDelta: string;
  /** Running while deltas are held back: at most one append per `DELTA_INTERVAL_MS`. */
  deltaTimer: Timer | undefined;
  /** The tool calls of the current turn, by id; cleared when the turn ends (2.3 F7). */
  toolCalls: Map<string, ToolCallState>;
  /** Stops listening to the agent. */
  off: (() => void) | undefined;
  /**
   * The agent started a new session in place of the chat's earlier one: the
   * next prompt carries the transcript (`primedPrompt`) until one succeeds.
   */
  prime: boolean;
  /** That new session's id, saved as the adapter ref only once a primed prompt succeeded (2.7 F4). */
  unsavedRef: string | undefined;
  /** Resolves when the agent is dropped or closed: a prompt still running is abandoned. */
  gone: Promise<void>;
  markGone: () => void;
  /** The permission mode changes being told to the agent, one after another (permission modes). */
  modeSync: Promise<void>;
  /** Whether it was started with the protected paths guarded (asked for in Auto only). */
  guardsRequested: boolean;
  /** Its guards don't fit the chat's mode any more: it is restarted at the next idle point (before the next prompt). */
  restartPending: boolean;
}

/** A session's terminal and its viewers (story 3.1). Its output is never logged, evented or stored. */
/** One viewer of a {@link Terminal} (story 3.5). */
export interface TerminalViewerEntry {
  /** Its own size, once it has resized; until then it types at whatever size the terminal has. */
  size: TerminalSize | undefined;
  /** Told when the terminal's size changes because of another viewer, or of this one's write. */
  sized: Set<(size: TerminalSize) => void>;
}

export interface Terminal {
  process: TerminalProcess;
  backlog: string;
  /** The size the terminal is at (story 3.5): its opening size, then the last viewer's to resize or type. */
  size: TerminalSize;
  /** Its viewers now (story 3.5). */
  viewers: Set<TerminalViewerEntry>;
  data: Set<(data: string) => void>;
  end: Set<(end: { exitCode: number | null }) => void>;
  ended: boolean;
  /** Resolves when the process has exited. */
  exited: Promise<void>;
  /** Set when the CLI exited by itself while the switch that opened it still held the session (story 3.4): that switch finishes it. */
  exit: { exitCode: number | null } | undefined;
}

/** A session whose agent is answering: from the first message until nothing is left to send. */
export interface Turn {
  /** Messages sent while the agent answered, oldest first. */
  queue: Array<{ messageId: string; text: string }>;
  /** Deny reasons to send after the turn, ahead of the queue. */
  reasons: string[];
  /** Fires the check-in after a quiet stretch. */
  quiet: Timer | undefined;
  /** Drops the agent if a Stop did not end the turn in time. */
  stopTimer: Timer | undefined;
  stopping: boolean;
  /** The turn ended in `error`: nothing more is sent. */
  failed: boolean;
}
