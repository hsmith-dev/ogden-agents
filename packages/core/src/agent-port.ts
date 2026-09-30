/**
 * The port every chat agent implements (AD-1): start a session in a folder,
 * send it a prompt, cancel, close, and listen to what it does. Core names no
 * agent, CLI or protocol here; the `acp-*` adapters do.
 *
 * An adapter never touches the database or the event log (AD-11): it reports
 * through {@link AgentSession.onEvent}, and core turns that into session
 * events and the session's normalized state (AD-4).
 */
import { CoreError } from './errors.js';

/** What an agent session reports while it works. */
export type AgentEvent =
  /** A piece of the agent's reply, in order. */
  | { type: 'message_chunk'; text: string }
  /** The agent started a tool call (read a file, run a command, …). */
  | { type: 'tool_call'; toolCallId: string; title: string; kind?: string | undefined; status?: string | undefined }
  /** A tool call's progress or result. */
  | { type: 'tool_call_update'; toolCallId: string; title?: string | undefined; status?: string | undefined }
  /**
   * The adapter's view of the session (AD-4): `working` while a prompt runs,
   * `idle` once it has ended, `error` when the agent failed or went away.
   * `reason` is plain words for the user and never holds a secret. `fatal`
   * means the agent's process is gone and the session can't take another
   * prompt; without it (say, a rate limit) the session stays usable.
   */
  | { type: 'state'; state: 'working' | 'idle' | 'error'; reason?: string | undefined; fatal?: boolean | undefined };

export type AgentEventListener = (event: AgentEvent) => void;

export interface StartAgentSession {
  /** The folder the agent works in: the workspace's repo root. */
  cwd: string;
  /**
   * The child process environment, as core passes it (AD-16: API keys go
   * here, never on a command line or in an event). The adapter may add its
   * own agent-specific variables but must not log it.
   */
  env: Readonly<Record<string, string>>;
}

export interface AgentSession {
  /** The agent's own id for this session (an adapter ref, never a key; AD-9). */
  readonly agentSessionId: string;
  /**
   * Sends one user message. Resolves when the agent has finished its turn,
   * with why it stopped; rejects with an {@link AgentError} if the agent
   * failed or went away. Either way the adapter has already reported the
   * `idle` or `error` state through {@link onEvent}.
   */
  prompt(text: string): Promise<{ stopReason: string }>;
  /** Asks the agent to stop the running prompt; it ends with `idle`. */
  cancel(): Promise<void>;
  /** Ends the session and stops the agent's process. Safe to call more than once. */
  close(): Promise<void>;
  /** Calls `listener` with every event from now on. Returns the unsubscribe. */
  onEvent(listener: AgentEventListener): () => void;
}

/** One agent (Claude Code, Codex, …) behind the port. */
export interface AgentPort {
  /** The agent's product name for the UI ("Claude Code"). */
  readonly displayName: string;
  /**
   * Starts the agent and a new session in `cwd`. Rejects with an
   * {@link AgentError} (code `agent_unavailable` when it can't be started).
   */
  startSession(input: StartAgentSession): Promise<AgentSession>;
}

export type AgentErrorCode = 'agent_unavailable' | 'agent_failed';

/**
 * An agent failure with a plain-language message for the UI. `details` are
 * for the log only and must hold no secret (AD-16).
 */
export class AgentError extends CoreError {
  override readonly name = 'AgentError';
  override readonly code: AgentErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  /**
   * The end of what the agent printed, secrets masked, for showing the user
   * why it failed. Held in memory only: never logged, never in `details`.
   */
  readonly output: string | undefined;
  constructor(
    code: AgentErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown; output?: string | undefined } = {},
  ) {
    super(code, message);
    this.code = code;
    this.details = options.details ?? {};
    this.output = options.output;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}
