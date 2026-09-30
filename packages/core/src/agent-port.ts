/**
 * The port every chat agent implements (AD-1): start or reopen a session in
 * a folder, send it a prompt, answer its permission requests, cancel, close,
 * listen to what it does, and list how it signs in. Core names no
 * agent, CLI or protocol here; the `acp-*` adapters do.
 *
 * An adapter never touches the database or the event log (AD-11): it reports
 * through {@link AgentSession.onEvent}, and core turns that into session
 * events and the session's normalized state (AD-4).
 */
import { CoreError } from './errors.js';

/** One file change a tool call reports (secrets masked). `oldText` is `null` for a new file. */
export interface AgentToolCallDiff {
  path: string;
  oldText: string | null;
  newText: string;
}

/** What an agent session reports while it works. */
export type AgentEvent =
  /** A piece of the agent's reply, in order. */
  | { type: 'message_chunk'; text: string }
  /** The agent started a tool call (read a file, run a command, …). */
  | {
      type: 'tool_call';
      toolCallId: string;
      title: string;
      kind?: string | undefined;
      status?: string | undefined;
      diffs?: AgentToolCallDiff[] | undefined;
    }
  /** A tool call's progress or result. */
  | {
      type: 'tool_call_update';
      toolCallId: string;
      title?: string | undefined;
      kind?: string | undefined;
      status?: string | undefined;
      diffs?: AgentToolCallDiff[] | undefined;
    }
  /**
   * The adapter's view of the session (AD-4): `working` while a prompt runs,
   * `idle` once it has ended, `error` when the agent failed or went away.
   * `reason` is plain words for the user and never holds a secret. `fatal`
   * means the agent's process is gone and the session can't take another
   * prompt; without it (say, a rate limit) the session stays usable. `code`
   * says why, when the UI acts on it (`auth_required`: sign in again; 9.4).
   */
  | {
      type: 'state';
      state: 'working' | 'idle' | 'error';
      reason?: string | undefined;
      fatal?: boolean | undefined;
      code?: AgentErrorCode | undefined;
    };

export type AgentEventListener = (event: AgentEvent) => void;

/** A tool call the agent asks permission to run (CAP-4). Secrets masked. */
export interface AgentPermissionRequest {
  toolCallId: string;
  title: string;
  /** The tool kind as the agent names it (`execute`, `edit`, …), if it said. */
  kind?: string | undefined;
  /** The command a shell tool call would run, if it said. */
  command?: string | undefined;
  /**
   * Every file path the tool call names (its locations, its diffs, and path
   * fields of its input), as the agent gave them. Always-allow rules for
   * file kinds match only when all of them lie inside the workspace.
   */
  paths?: readonly string[] | undefined;
}

/**
 * Core's answer to a permission request. There is no `allow_always`: an
 * always-allow is a rule core stores and enforces itself, and the agent is
 * only ever told "once" (epic decision, 2026-09-30).
 */
export type AgentPermissionDecision =
  | { outcome: 'allow_once' }
  | { outcome: 'deny'; reason?: string | undefined }
  | { outcome: 'cancelled' };

export interface StartAgentSession {
  /** The folder the agent works in: the workspace's repo root. */
  cwd: string;
  /**
   * The child process environment, as core passes it (AD-16: API keys go
   * here, never on a command line or in an event). The adapter may add its
   * own agent-specific variables but must not log it.
   */
  env: Readonly<Record<string, string>>;
  /**
   * Called when the agent asks to run a tool call. The tool call does not run
   * until it resolves. Without it the adapter declines every request, so
   * nothing runs without a person.
   */
  onPermissionRequest?: ((request: AgentPermissionRequest) => Promise<AgentPermissionDecision>) | undefined;
}

/** How a reopened session got its context back: the agent resumed it, loaded it, or had to start a new one. */
export type AgentRestored = 'resumed' | 'loaded' | 'new';

export interface ReopenAgentSession extends StartAgentSession {
  /** The agent's own id for the session to reopen (the adapter ref stored on the session; AD-9). */
  agentSessionId: string;
}

/**
 * One way to sign in to an agent. `terminal` methods run the agent's own
 * login in a terminal the server drives (with `args` and `env`); `agent`
 * methods are done by the agent itself.
 */
export interface AgentAuthMethod {
  id: string;
  name: string;
  description?: string | undefined;
  kind: 'terminal' | 'agent';
  args?: readonly string[] | undefined;
  env?: Readonly<Record<string, string>> | undefined;
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
  /**
   * Starts the agent on a session it had before (E2-R2): the adapter resumes
   * it if the agent can, else loads it (its replayed history is not reported
   * again), else starts a new session (`restored: 'new'`), and core primes it
   * from the stored transcript (2.7). Rejects as {@link startSession} does.
   */
  reopenSession(input: ReopenAgentSession): Promise<{ session: AgentSession; restored: AgentRestored }>;
  /**
   * The ways the agent offers to sign in (onboarding 9.x): starts the agent,
   * asks, and stops it. Rejects with an {@link AgentError} when it can't be started.
   */
  listAuthMethods(input: { env: Readonly<Record<string, string>> }): Promise<AgentAuthMethod[]>;
}

export type AgentErrorCode = 'agent_unavailable' | 'agent_failed' | 'auth_required';

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
