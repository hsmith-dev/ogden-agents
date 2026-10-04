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
import { AgentId as AgentIdSchema, type AgentId, type AgentModel, type PermissionMode } from '@ogden-agents/shared';
import { agentDescriptorProblems, declaredModes, type AgentDescriptor } from './agent-descriptor.js';
import { CoreError } from './errors.js';
import type { AgentSandbox } from './sandbox-port.js';

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
   * The agent says it now runs in another permission mode (permission modes):
   * `mode` is the Ogden mode it maps to, or `other` (planning, accepting
   * edits, anything else). `asksLess` says whether it asks less than Ask (an
   * agent that does is told Ask). `label` is the agent's own name for the
   * mode, for the plain reason the chat shows. Core moves a chat to Ask on
   * any mode it didn't choose; the adapter reports a mode it was told to take
   * only when the agent reports it too (core ignores that echo).
   */
  | { type: 'permission_mode'; mode: PermissionMode | 'other'; asksLess: boolean; label?: string | undefined }
  /**
   * The agent says it now runs on another model (story 11), by its own id,
   * when it changed by itself (a fallback): never the echo of a model it was
   * told to take. Core moves a chat that chose a model to the reported one.
   */
  | { type: 'model'; model: string }
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

/**
 * Folders and files (by name, at any depth) the agent must still ask before
 * writing, even in its own auto mode (permission modes, user decision
 * 2026-10-02: "Keep protected files guarded"): so such an edit reaches Ogden
 * as a card. Core passes the 2.8 protected paths; the adapter turns them into
 * the agent's own rules.
 */
export interface ProtectedPaths {
  folders: readonly string[];
  files: readonly string[];
}

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
  /**
   * Paths to keep guarded (ask before writing) for the whole session. Core
   * passes them only for a chat in Auto: an agent can't change them once it
   * runs, and they would hold even in Skip all, so a chat that moves into or
   * out of Auto gets a new agent session (resumed) at its next idle point.
   */
  protectedPaths?: ProtectedPaths | undefined;
  /**
   * The model to start on (story 11), for an agent that takes it only at
   * start (its descriptor's static `models`): the adapter applies it to the
   * process (a variable or an argument). Ignored by an agent whose session
   * lists its models (core tells it with {@link AgentSession.setModel}).
   * Absent: the agent's own choice.
   */
  model?: string | undefined;
  /**
   * An unattended build session's sandbox (story 5.2): the agent runs its
   * commands in its own native sandbox with only these roots writable and
   * no network, and may never run one outside it. Fixed for the session's
   * life. Absent for every chat.
   */
  sandbox?: AgentSandbox | undefined;
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
  /**
   * Puts a user message into the running prompt's turn (send now or wait):
   * `injected` when the agent took it (what it says next streams as part of
   * the running prompt, which resolves only once it has answered it);
   * `no_turn` when no turn was running, so nothing was sent. Rejects when
   * the agent refused it. Absent when the agent (or this session of it)
   * can't take a message mid-turn: core stops the step instead.
   */
  steer?(text: string): Promise<'injected' | 'no_turn'>;
  /** Ends the session and stops the agent's process. Safe to call more than once. */
  close(): Promise<void>;
  /** Calls `listener` with every event from now on. Returns the unsubscribe. */
  onEvent(listener: AgentEventListener): () => void;
  /**
   * The permission modes this session offers (it may offer fewer than its
   * agent declares). Absent: Ask only.
   */
  readonly permissionModes?: readonly PermissionMode[] | undefined;
  /** Whether the session was started with `protectedPaths` in effect. Core puts only such a session in Auto. */
  readonly protectsPaths?: boolean | undefined;
  /**
   * Puts the session in `mode`. Resolves once the agent has taken it (at once
   * when it already runs in it); rejects when it can't. Absent: the session
   * only ever runs in Ask, and core never asks it for another mode.
   */
  setPermissionMode?(mode: PermissionMode): Promise<void>;
  /**
   * The models this session offers and the one it runs on now, as the agent
   * last said (story 11); absent when it lists none.
   */
  readonly models?: AgentSessionModels | undefined;
  /**
   * Puts the running session on `model` (the agent's own id), or back on the
   * model it chose itself when it started (`null`), for its next prompt.
   * Resolves once the agent has taken it (at once when it runs on it);
   * rejects with an {@link AgentError} whose message is the agent's own plain
   * reason (masked) when it refuses. Absent: the agent takes a model only at
   * start ({@link StartAgentSession.model}), so core restarts it to switch.
   */
  setModel?(model: string | null): Promise<void>;
}

/** The models an agent session offers (story 11). */
export interface AgentSessionModels {
  available: readonly AgentModel[];
  /** The model it runs on now, when it said. */
  current?: string | undefined;
}

/** One agent (Claude Code, Codex, …) behind the port. */
export interface AgentPort {
  /** The agent's product name for the UI ("Claude Code"). */
  readonly displayName: string;
  /**
   * The permission modes the agent can run a chat in (permission modes; an
   * agent declares them, so every agent fills the same contract). Absent:
   * Ask only. Core starts every session in Ask and offers only these.
   */
  readonly permissionModes?: readonly PermissionMode[] | undefined;
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
  /**
   * The message that makes this agent run the installed skill `skill` (a
   * catalog name; story 4.1), with the user's `idea` when given (story 4.2,
   * "Start from an idea": already trimmed and at most `MAX_IDEA_LENGTH`
   * characters), sent as a planning session's first message. Core names no
   * skill and no agent's command syntax (AD-12): this does.
   */
  skillInvocation(skill: string, idea?: string): string;
  /**
   * The agent's own CLI on its sessions (CAP-5, story 3.2), for an agent whose
   * sessions its CLI can resume; absent otherwise (the terminal is then
   * `agent_unsupported`).
   */
  terminalResume?: AgentTerminalResume;
}

/**
 * How an agent's own CLI resumes its sessions in a terminal (CAP-5). Every
 * `env` is the environment the chat's agent process gets.
 */
export interface AgentTerminalResume {
  /**
   * The CLI resuming `agentSessionId`, in the chat's permission mode
   * (`options.permissionMode`, Ask when absent): the CLI starts in its asking
   * mode, its auto mode, or skipping its permission checks. It runs with the
   * `env` returned (the same, or with the caller's own rules applied).
   * Rejects with an {@link AgentError} when it can't be built (the CLI is not found).
   */
  command(agentSessionId: string, env: Readonly<Record<string, string>>, options?: AgentTerminalOptions): Promise<AgentTerminalCommand>;
  /** Whether the CLI can be found, or the plain reason it can't (never a path). */
  locate(env: Readonly<Record<string, string>>): Promise<AgentCliLocation>;
  /**
   * The session's conversation as the CLI recorded it, oldest first, so core
   * can import the turns typed in the terminal after switching back (story
   * 3.3). Absent when the agent can't read it back. Resolves `[]` when the
   * session has no record yet; rejects, with no path or content in the
   * error, when the record can't be read (too large, unreadable).
   */
  transcript?(input: { agentSessionId: string; cwd: string; env: Readonly<Record<string, string>> }): Promise<AgentTranscriptTurn[]>;
}

/** How the agent's CLI is to start (permission modes). */
export interface AgentTerminalOptions {
  permissionMode: PermissionMode;
  /** The chat's model (story 11), the agent's own id; absent: the CLI's own choice. */
  model?: string | undefined;
  /** Paths the CLI must still ask before writing (given in Auto only). */
  protectedPaths?: ProtectedPaths | undefined;
}

export type AgentCliLocation = { found: true } | { found: false; reason: string };

/**
 * One message of a session's conversation as the agent's CLI recorded it
 * (story 3.3): a user's text, or the joined text of the agent's reply to it.
 */
export interface AgentTranscriptTurn {
  /**
   * The id of the exchange the message belongs to (Claude Code: its user
   * record's `uuid`), shared by a user message and the agent's reply to it.
   * Stable across reads, so core can mark where its import got to.
   */
  id: string;
  role: 'user' | 'agent';
  text: string;
}

/** The CLI to run for a session's terminal: a file, its arguments (no shell) and its whole environment. */
export interface AgentTerminalCommand {
  file: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
}

/** `usage_limit`: the agent ran out of usage (its descriptor's patterns matched; handoff), its session is still usable. */
export type AgentErrorCode = 'agent_unavailable' | 'agent_failed' | 'auth_required' | 'usage_limit';

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

/**
 * One agent a chat can be started with, as server wiring registers it (epic
 * 6): what it is (its descriptor, 6.3) and its chat port.
 */
export interface RegisteredAgent {
  descriptor: AgentDescriptor;
  agent: AgentPort;
}

/**
 * The agents chats can be started with, by id (epic 6; AD-1 note): server
 * wiring builds it, and core looks each session's agent up here, so core
 * names no agent itself.
 */
export interface AgentRegistry {
  /** Every registered agent's id, in the order the UI lists them. */
  readonly agentIds: readonly AgentId[];
  /** The agent registered under `agentId`, if any. */
  get(agentId: AgentId): AgentPort | undefined;
  /** What the agent registered under `agentId` is (6.3), if any. */
  describe(agentId: AgentId): AgentDescriptor | undefined;
  /** The agent a new chat gets when none is picked. */
  readonly defaultAgentId: AgentId;
  /** The agent the sessions stored before agents could be chosen were started with (they have no `agentId`). */
  readonly legacyAgentId: AgentId;
}

/**
 * The agent a new chat in a project gets when none is picked (epic 6, entry
 * 6): the project's own default while it is still registered, else the
 * install's. One rule for chat and for BMad's skill folders (entry 8).
 */
export function effectiveDefaultAgent(agents: Pick<AgentRegistry, 'get' | 'defaultAgentId'>, projectDefault: AgentId | undefined): AgentId {
  return projectDefault !== undefined && agents.get(projectDefault) !== undefined ? projectDefault : agents.defaultAgentId;
}

/**
 * A registry of `agents`, in order. `defaultAgentId` and `legacyAgentId`
 * default to the first agent; the default must be registered. Throws (a
 * wiring bug) on an empty list, an id given twice, a descriptor with a
 * problem ({@link agentDescriptorProblems}), or a port whose product name or
 * declared permission modes differ from its descriptor's.
 */
export function createAgentRegistry(
  agents: readonly RegisteredAgent[],
  options: { defaultAgentId?: AgentId | undefined; legacyAgentId?: AgentId | undefined } = {},
): AgentRegistry {
  const byId = new Map<AgentId, RegisteredAgent>();
  for (const registered of agents) {
    const { descriptor, agent } = registered;
    const agentId = descriptor.agentId;
    if (!AgentIdSchema.safeParse(agentId).success) throw new Error(`agent registry: ${JSON.stringify(agentId)} is not an agent id`);
    if (byId.has(agentId)) throw new Error(`agent registry: ${agentId} is registered twice`);
    const problems = agentDescriptorProblems(descriptor);
    if (problems.length > 0) throw new Error(`agent registry: ${problems.join('; ')}`);
    if (agent.displayName !== descriptor.displayName) throw new Error(`agent registry: ${agentId}'s port is named ${JSON.stringify(agent.displayName)}, its descriptor ${JSON.stringify(descriptor.displayName)}`);
    const portModes = [...new Set(agent.permissionModes ?? ['ask'])].sort().join(',');
    const described = declaredModes(descriptor).sort().join(',');
    if (portModes !== described) throw new Error(`agent registry: ${agentId}'s port declares the modes ${portModes}, its descriptor ${described}`);
    byId.set(agentId, registered);
  }
  const first = agents[0]?.descriptor.agentId;
  if (first === undefined) throw new Error('agent registry: no agent registered');
  const defaultAgentId = options.defaultAgentId ?? first;
  if (!byId.has(defaultAgentId)) throw new Error(`agent registry: the default agent ${defaultAgentId} is not registered`);
  const legacyAgentId = options.legacyAgentId ?? first;
  if (!AgentIdSchema.safeParse(legacyAgentId).success) throw new Error(`agent registry: ${JSON.stringify(legacyAgentId)} is not an agent id`);
  return {
    agentIds: [...byId.keys()],
    get: (agentId) => byId.get(agentId)?.agent,
    describe: (agentId) => byId.get(agentId)?.descriptor,
    defaultAgentId,
    legacyAgentId,
  };
}

/** The plain reason a chat whose agent this install no longer has can't reach it. */
export const AGENT_NOT_REGISTERED_REASON = "This chat's agent isn't available in Ogden Agents on this computer.";

/**
 * Stands in for a session's agent that isn't registered this run (a test
 * agent, or one removed): every start fails `agent_unavailable` with
 * {@link AGENT_NOT_REGISTERED_REASON}, and it offers Ask only and no terminal.
 */
export function unregisteredAgent(): AgentPort {
  const unavailable = () => Promise.reject(new AgentError('agent_unavailable', AGENT_NOT_REGISTERED_REASON));
  return {
    displayName: "This chat's agent",
    permissionModes: ['ask'],
    skillInvocation: (skill, idea) => (idea === undefined ? `/${skill}` : `/${skill} ${idea}`),
    startSession: unavailable,
    reopenSession: unavailable,
    listAuthMethods: unavailable,
  };
}
