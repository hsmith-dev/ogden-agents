/**
 * The chat use-case's types (moved from `chat.ts`, story 3.11): the public
 * `ChatOptions`, `TerminalViewer` and `Chat`, and the state the chat modules
 * share by reference (`Live`, `Terminal`, `Turn`).
 */
import type { Session, SessionDriver, SessionId, ToolCallDiff, ToolCallStatus, ToolKind, Workspace, WorkspaceId } from '@ogden-agents/shared';
import type { AgentError, AgentPort, AgentSession } from '../agent-port.js';
import type { Entities } from '../entities.js';
import type { HistoryDeleted } from '../event-log.js';
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
  agent: AgentPort;
  /**
   * Answers the agents' permission requests. Default: the declining stub
   * ({@link createDecliningPermissions}), which denies every request.
   */
  permissions?: Permissions;
  /**
   * The environment each agent process gets (AD-16: API keys go here and
   * nowhere else). Called for every agent start. Default: none.
   */
  agentEnv?: () => Readonly<Record<string, string>>;
  /** Called with every agent failure, for the log. Its `details` hold no secret. */
  onAgentError?: (sessionId: SessionId, error: AgentError) => void;
  /** Called when applying an agent's event failed (such as a session deleted mid-reply), for the log. */
  onInternalError?: (sessionId: SessionId, error: unknown) => void;
  /** How long a `working` agent may be silent before core checks in, clamped by {@link clampCheckInDelay}. Default {@link DEFAULT_CHECK_IN_MS}. */
  checkInDelayMs?: number;
  /** How long Stop waits for the turn to end before dropping the agent. Default {@link STOP_GRACE_MS}. */
  stopGraceMs?: number;
  /** Opens the agent's own CLI in a terminal (story 3.1). Without it, switching to the terminal is refused. */
  terminal?: TerminalPort;
}

/**
 * One viewer's hold on a session's terminal (story 3.1). What it carries is
 * the user's content: never log, event or store it.
 */
export interface TerminalViewer {
  /** The most recent output, at most {@link TERMINAL_BACKLOG_CHARS}, for a viewer that just attached. */
  readonly backlog: string;
  /** Everything the terminal prints from now on. Returns the unsubscribe. */
  onData(listener: (data: string) => void): () => void;
  /** Called once when the terminal ends: its CLI exited (`exitCode`), or the session switched back (`null`). Returns the unsubscribe. */
  onEnd(listener: (end: { exitCode: number | null }) => void): () => void;
  /** Types into the terminal. */
  write(data: string): void;
  /** Resizes the terminal. */
  resize(cols: number, rows: number): void;
}

export interface Chat {
  /**
   * The workspace for the repo at `path`, created if new (AD-2). `path` must
   * be absolute (a leading `~` is the user's home). Throws
   * {@link InvalidOperationError} if it isn't, if it is not an existing
   * folder, or if it is, holds or sits inside Ogden Agents' data folder.
   */
  openWorkspace(path: string): Workspace;
  /** Every workspace of this install, oldest first. */
  listWorkspaces(): Workspace[];
  /** The workspace ({@link NotFoundError} if there is none). */
  getWorkspace(workspaceId: WorkspaceId): Workspace;
  /** The workspace's sessions, oldest first ({@link NotFoundError} for an unknown workspace). */
  listSessions(workspaceId: WorkspaceId): Session[];
  /**
   * Deletes the workspace's history: its events, sessions and runs; the
   * workspace and every other workspace stay. Throws
   * {@link WorkspaceBusyError}, deleting nothing, while one of its sessions is
   * `working` or `waiting` or its agent is still answering, and
   * {@link NotFoundError} for an unknown workspace. The deleted sessions'
   * idle agents are then stopped.
   */
  deleteHistory(workspaceId: WorkspaceId): Omit<HistoryDeleted, 'event'>;
  /** A new chat session in the workspace, `idle`. */
  createChatSession(workspaceId: WorkspaceId): Session;
  /** The session, which must belong to the workspace ({@link NotFoundError} otherwise). */
  getSession(workspaceId: WorkspaceId, sessionId: SessionId): Session;
  /**
   * Stores the user's message and hands it to the session's agent, starting
   * the agent first if needed. Returns once the message is stored; the reply
   * and the state follow through the event log. While the agent is still
   * answering, the message is queued (`queued: true`) and sent when the turn
   * ends. Throws {@link QueueFullError} when {@link MAX_QUEUED_MESSAGES} are
   * already queued, {@link SessionBusyError} while a failed turn is ending,
   * {@link DriverIsTerminalError} while the terminal drives the session (AD-6),
   * and {@link SessionNotIdleError} while it is switching drivers.
   */
  sendMessage(workspaceId: WorkspaceId, sessionId: SessionId, text: string): { messageId: string; queued: boolean };
  /**
   * Stop: asks the agent to cancel its running prompt, declines the pending
   * permission requests (the session leaves `waiting` for `idle`) and drops
   * the queued messages, which stay unsent. The session ends `idle`; an agent
   * that has not ended its turn within the grace period is dropped and the
   * session is `idle`, resumable. Throws {@link SessionNotBusyError} when no
   * turn is running and {@link NotFoundError} for an unknown session.
   */
  cancel(workspaceId: WorkspaceId, sessionId: SessionId): void;
  /**
   * Hands the session to `driver` (story 3.1, AD-6). To `terminal`: only
   * while the session is `idle`, with no turn or queue, and has reached its
   * agent; the agent's process is released and has exited before its CLI
   * opens on the same agent session. To `ui`: the CLI and its tree are
   * killed, then the turns typed in it are imported. Each change appends
   * `session.driver_changed` with its cause; asking for the current driver
   * changes nothing. Throws {@link SessionNotIdleError} or
   * {@link TerminalUnavailableError} with a plain reason (nothing changed)
   * and {@link NotFoundError} for an unknown session.
   */
  switchDriver(workspaceId: WorkspaceId, sessionId: SessionId, driver: SessionDriver): Promise<Session>;
  /** A hold on the session's running terminal, or `undefined` when the terminal does not drive it. */
  attachTerminal(sessionId: SessionId): TerminalViewer | undefined;
  /** Resolves once no agent turn is running (tests, shutdown). */
  settled(): Promise<void>;
  /**
   * Ends every agent session and stops their processes (AD-3: the server
   * owns them). Sessions still answering become `idle`, resumable, with
   * {@link RESTARTED_REASON}, before their agents stop.
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
  /** Running while deltas are held back: at most one append per {@link DELTA_INTERVAL_MS}. */
  deltaTimer: Timer | undefined;
  /** The tool calls of the current turn, by id; cleared when the turn ends (2.3 F7). */
  toolCalls: Map<string, ToolCallState>;
  /** Stops listening to the agent. */
  off: (() => void) | undefined;
  /**
   * The agent started a new session in place of the chat's earlier one: the
   * next prompt carries the transcript ({@link primedPrompt}) until one succeeds.
   */
  prime: boolean;
  /** That new session's id, saved as the adapter ref only once a primed prompt succeeded (2.7 F4). */
  unsavedRef: string | undefined;
  /** Resolves when the agent is dropped or closed: a prompt still running is abandoned. */
  gone: Promise<void>;
  markGone: () => void;
}

/** A session's terminal and its viewers (story 3.1). Its output is never logged, evented or stored. */
export interface Terminal {
  process: TerminalProcess;
  backlog: string;
  data: Set<(data: string) => void>;
  end: Set<(end: { exitCode: number | null }) => void>;
  ended: boolean;
  /** Resolves when the process has exited. */
  exited: Promise<void>;
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
