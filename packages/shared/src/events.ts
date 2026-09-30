import { z } from 'zod';
import { Run, RunOutcome, Session, SessionDriver, SessionState, Workspace } from './entities.js';
import { ApiErrorCode } from './errors.js';
import { EventId, PermissionRuleId, RunId, SessionId, WorkspaceId } from './ids.js';
import { IsoUtcTimestamp } from './time.js';
import { ToolchainErrorCode, ToolName, ToolSource } from './toolchain.js';

/**
 * The event log contract (AD-5) and the wire contract for the events
 * WebSocket (`/ws`).
 *
 * Every event core appends is a `CoreEvent`: the envelope
 * `{ id, seq, workspaceId, streamId, type, at, payload }` with a per-type
 * payload. `seq` is assigned by the database and increases strictly across the
 * install. `workspaceId` is `null` only for install-level events such as
 * `server.started`.
 *
 * Every message the server sends is a `ServerMessage`; every message a client
 * sends must parse as a `ClientMessage`. Anything else is rejected.
 */

/** Install-wide position in the event log, assigned by SQLite. */
export const Seq = z.number().int().positive();
export type Seq = z.infer<typeof Seq>;

/** The stream of install-level events (those with `workspaceId: null`). */
export const SERVER_STREAM = 'server';

/** The stream of toolchain events (install-level: `workspaceId: null`). */
export const TOOLCHAIN_STREAM = 'toolchain';

/**
 * The stream of agent install and sign-in events (install-level:
 * `workspaceId: null`; onboarding, epic 9). They never carry a sign-in URL,
 * a launch code or a key (AD-15, AD-16): the sign-in URL travels only in a
 * `no-store` REST response.
 */
export const AGENTS_STREAM = 'agents';

/**
 * How many recent events a `subscribe_workspace` sends when it names no
 * `window` (E2-R8): the UI never replays a workspace's whole history.
 */
export const DEFAULT_WINDOW_EVENTS = 200;
/** The most events one `page_history` (or a subscription's `window`) returns. */
export const MAX_PAGE_EVENTS = 500;

// ---------------------------------------------------------------------------
// Shared enums (story 2.3).
// ---------------------------------------------------------------------------

/** What a tool call does, as ACP names it. Caution levels classify requests by it (E2-R4). */
export const TOOL_KINDS = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other'] as const;
export const ToolKind = z.enum(TOOL_KINDS);
export type ToolKind = z.infer<typeof ToolKind>;

/** A tool call's progress. */
export const TOOL_CALL_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const;
export const ToolCallStatus = z.enum(TOOL_CALL_STATUSES);
export type ToolCallStatus = z.infer<typeof ToolCallStatus>;

/**
 * A workspace's caution level (E2-R4; EXPERIENCE.md Caution level): Ask every
 * time (the default for new projects), Ask for commands, Ask only for risky
 * actions. Changing it applies only to requests not yet shown.
 */
export const CAUTION_LEVELS = ['ask_every_time', 'ask_for_commands', 'ask_risky_only'] as const;
export const CautionLevel = z.enum(CAUTION_LEVELS);
export type CautionLevel = z.infer<typeof CautionLevel>;
export const DEFAULT_CAUTION_LEVEL: CautionLevel = 'ask_every_time';

/** An agent's stable id, kebab-case (`claude-code`, `codex`). Not an Ogden Agents key (AD-9). */
export const AgentId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a kebab-case agent id')
  .max(64);
export type AgentId = z.infer<typeof AgentId>;

/**
 * The most characters of a diff's old or new text an event carries (each side
 * on its own). Core cuts longer text before it appends, and flags the diff
 * `truncated` (story 2.3 review F1).
 */
export const MAX_DIFF_TEXT_LENGTH = 64 * 1024;

/**
 * One file change a tool call reports: the old and new text (`oldText` is
 * `null` for a new file), each at most {@link MAX_DIFF_TEXT_LENGTH}
 * characters. `truncated` is `true` when core cut either side. Secrets masked.
 */
export const ToolCallDiff = z.object({
  path: z.string().min(1),
  oldText: z.string().max(MAX_DIFF_TEXT_LENGTH).nullable(),
  newText: z.string().max(MAX_DIFF_TEXT_LENGTH),
  truncated: z.literal(true).optional(),
});
export type ToolCallDiff = z.infer<typeof ToolCallDiff>;

/** Identifies one pending permission request within a session. */
export const PermissionRequestId = z.string().min(1).max(128);
export type PermissionRequestId = z.infer<typeof PermissionRequestId>;

/**
 * What an "Always allow" would cover (EXPERIENCE.md Permission card: the
 * scope written under the button): a command prefix, or a tool, in this
 * workspace. `label` is plain words for the user.
 */
export const AlwaysAllowScope = z.object({
  kind: z.enum(['command_prefix', 'tool']),
  value: z.string().min(1),
  label: z.string().min(1),
});
export type AlwaysAllowScope = z.infer<typeof AlwaysAllowScope>;

/** The user's (or a rule's) answer to a permission request. `allow_always` is stored as a rule in core, never passed to the agent. */
export const PERMISSION_DECISIONS = ['allow_once', 'allow_always', 'deny'] as const;
export const PermissionDecision = z.enum(PERMISSION_DECISIONS);
export type PermissionDecision = z.infer<typeof PermissionDecision>;

/** Longest reason a Deny may send back to the agent, in characters. */
export const MAX_DENY_REASON_LENGTH = 2000;

/** Why a session went to `error`, when it is one the UI acts on (`auth_required`: Sign in again). */
export const SESSION_ERROR_CODES = ['agent_unavailable', 'agent_failed', 'auth_required'] as const;
export const SessionErrorCode = z.enum(SESSION_ERROR_CODES);
export type SessionErrorCode = z.infer<typeof SessionErrorCode>;

/** An agent's sign-in state (CAP-16). */
export const AGENT_AUTH_STATES = ['signed_in', 'needs_sign_in', 'signing_in', 'failed'] as const;
export const AgentAuthState = z.enum(AGENT_AUTH_STATES);
export type AgentAuthState = z.infer<typeof AgentAuthState>;

/** How an agent is signed in: the user's own subscription login, or an API key from the keychain (AD-16). */
export const AgentAuthMethodKind = z.enum(['subscription', 'api_key']);
export type AgentAuthMethodKind = z.infer<typeof AgentAuthMethodKind>;

/** Fields core fills in when it appends an event. */
const assigned = {
  id: EventId,
  seq: Seq,
  at: IsoUtcTimestamp,
};

/** Workspace-level events use the workspace's stream. */
const onWorkspaceStream = { workspaceId: WorkspaceId, streamId: WorkspaceId };
/** Session and run events share the session's stream: the run view is the session view (AD-8). */
const onSessionStream = { workspaceId: WorkspaceId, streamId: SessionId };

// ---------------------------------------------------------------------------
// Event types. Each is defined once without the core-assigned fields (what a
// caller asks core to append) and once as the stored envelope.
// ---------------------------------------------------------------------------

const ServerStartedInput = z.object({
  type: z.literal('server.started'),
  workspaceId: z.null(),
  streamId: z.literal(SERVER_STREAM),
  payload: z.object({ version: z.string().min(1) }),
});
/** Appended once each time the server has bound its port. */
export const ServerStartedEvent = ServerStartedInput.extend(assigned);
export type ServerStartedEvent = z.infer<typeof ServerStartedEvent>;

const WorkspaceCreatedInput = z.object({
  type: z.literal('workspace.created'),
  ...onWorkspaceStream,
  payload: z.object({ workspace: Workspace }),
});
/** A new workspace row was created (AD-2). */
export const WorkspaceCreatedEvent = WorkspaceCreatedInput.extend(assigned);
export type WorkspaceCreatedEvent = z.infer<typeof WorkspaceCreatedEvent>;

const WorkspaceHistoryDeletedInput = z.object({
  type: z.literal('workspace.history_deleted'),
  ...onWorkspaceStream,
  payload: z.object({
    deletedEvents: z.number().int().nonnegative(),
    deletedSessions: z.number().int().nonnegative(),
    deletedRuns: z.number().int().nonnegative(),
  }),
});
/**
 * A workspace's events, sessions and runs were deleted; the workspace itself
 * remains. Clients drop everything they hold for that workspace.
 */
export const WorkspaceHistoryDeletedEvent = WorkspaceHistoryDeletedInput.extend(assigned);
export type WorkspaceHistoryDeletedEvent = z.infer<typeof WorkspaceHistoryDeletedEvent>;

const WorkspacePermissionRuleAddedInput = z.object({
  type: z.literal('workspace.permission_rule_added'),
  ...onWorkspaceStream,
  payload: z.object({ ruleId: PermissionRuleId, scope: AlwaysAllowScope }),
});
/** An always-allow rule was stored for the workspace (E2-R3). */
export const WorkspacePermissionRuleAddedEvent = WorkspacePermissionRuleAddedInput.extend(assigned);
export type WorkspacePermissionRuleAddedEvent = z.infer<typeof WorkspacePermissionRuleAddedEvent>;

const WorkspacePermissionRuleRemovedInput = z.object({
  type: z.literal('workspace.permission_rule_removed'),
  ...onWorkspaceStream,
  payload: z.object({ ruleId: PermissionRuleId }),
});
/** An always-allow rule was undone. */
export const WorkspacePermissionRuleRemovedEvent = WorkspacePermissionRuleRemovedInput.extend(assigned);
export type WorkspacePermissionRuleRemovedEvent = z.infer<typeof WorkspacePermissionRuleRemovedEvent>;

const WorkspaceSettingsChangedInput = z.object({
  type: z.literal('workspace.settings_changed'),
  ...onWorkspaceStream,
  payload: z.object({ cautionLevel: CautionLevel, previous: CautionLevel }),
});
/** The workspace's caution level changed (E2-R4); it applies to requests not yet shown. */
export const WorkspaceSettingsChangedEvent = WorkspaceSettingsChangedInput.extend(assigned);
export type WorkspaceSettingsChangedEvent = z.infer<typeof WorkspaceSettingsChangedEvent>;

const SessionCreatedInput = z.object({
  type: z.literal('session.created'),
  ...onSessionStream,
  payload: z.object({ session: Session }),
});
export const SessionCreatedEvent = SessionCreatedInput.extend(assigned);
export type SessionCreatedEvent = z.infer<typeof SessionCreatedEvent>;

const SessionStateChangedInput = z.object({
  type: z.literal('session.state_changed'),
  ...onSessionStream,
  payload: z.object({
    sessionId: SessionId,
    state: SessionState,
    previous: SessionState,
    /** Why, in plain words for the user, when there is something to say (an `error`'s cause). Never a secret. */
    reason: z.string().min(1).optional(),
    /**
     * Set when the server moved the session to `idle` because its agent's
     * process is gone (a restart or a crash; AD-3): the chat can be resumed.
     */
    resumable: z.literal(true).optional(),
    /** Set with `error` when the UI acts on the cause (onboarding 9.4 sets `auth_required`). */
    errorCode: SessionErrorCode.optional(),
  }),
});
/** A session's normalized state changed (AD-4). */
export const SessionStateChangedEvent = SessionStateChangedInput.extend(assigned);
export type SessionStateChangedEvent = z.infer<typeof SessionStateChangedEvent>;

const SessionDriverChangedInput = z.object({
  type: z.literal('session.driver_changed'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, driver: SessionDriver, previous: SessionDriver }),
});
/** A session's driver changed (AD-6). */
export const SessionDriverChangedEvent = SessionDriverChangedInput.extend(assigned);
export type SessionDriverChangedEvent = z.infer<typeof SessionDriverChangedEvent>;

/** Identifies one message within a session's stream. */
export const MessageId = z.string().min(1);
export type MessageId = z.infer<typeof MessageId>;

export const MessageRole = z.enum(['user', 'agent']);
export type MessageRole = z.infer<typeof MessageRole>;

const SessionMessageDeltaInput = z.object({
  type: z.literal('session.message_delta'),
  ...onSessionStream,
  payload: z.object({ messageId: MessageId, role: MessageRole, text: z.string() }),
});
/**
 * A chunk of a message still being written. Pruned once the message's
 * `session.message_completed` has been appended (AD-5).
 */
export const SessionMessageDeltaEvent = SessionMessageDeltaInput.extend(assigned);
export type SessionMessageDeltaEvent = z.infer<typeof SessionMessageDeltaEvent>;

const SessionMessageCompletedInput = z.object({
  type: z.literal('session.message_completed'),
  ...onSessionStream,
  payload: z.object({ messageId: MessageId, role: MessageRole, content: z.string() }),
});
/** A finished message with its full content; it replaces that message's deltas. */
export const SessionMessageCompletedEvent = SessionMessageCompletedInput.extend(assigned);
export type SessionMessageCompletedEvent = z.infer<typeof SessionMessageCompletedEvent>;

const toolCallPayload = z.object({
  sessionId: SessionId,
  toolCallId: z.string().min(1),
  /** Plain words, secrets masked ("Edit src/booking.ts"). */
  title: z.string(),
  kind: ToolKind,
  status: ToolCallStatus,
  diffs: z.array(ToolCallDiff).optional(),
});

const SessionToolCallInput = z.object({
  type: z.literal('session.tool_call'),
  ...onSessionStream,
  payload: toolCallPayload,
});
/** The agent started a tool call (read a file, run a command, …). */
export const SessionToolCallEvent = SessionToolCallInput.extend(assigned);
export type SessionToolCallEvent = z.infer<typeof SessionToolCallEvent>;

const SessionToolCallUpdatedInput = z.object({
  type: z.literal('session.tool_call_updated'),
  ...onSessionStream,
  payload: toolCallPayload,
});
/**
 * A tool call's current state after an update: the whole call, not a delta,
 * except `diffs`, which is present only when the update changed them (the
 * latest `diffs` seen for the call still apply; story 2.3 review F1).
 */
export const SessionToolCallUpdatedEvent = SessionToolCallUpdatedInput.extend(assigned);
export type SessionToolCallUpdatedEvent = z.infer<typeof SessionToolCallUpdatedEvent>;

/** How a reopened chat got its context back (E2-R2): ACP resume, ACP load, or a new session primed from the stored transcript. */
export const ResumedVia = z.enum(['resumed', 'loaded', 'transcript']);
export type ResumedVia = z.infer<typeof ResumedVia>;

const SessionResumedInput = z.object({
  type: z.literal('session.resumed'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, via: ResumedVia }),
});
/** A chat was reopened after its agent's process was gone ("Resumed from history" when `via` is `transcript`). */
export const SessionResumedEvent = SessionResumedInput.extend(assigned);
export type SessionResumedEvent = z.infer<typeof SessionResumedEvent>;

const SessionMessageQueuedInput = z.object({
  type: z.literal('session.message_queued'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, messageId: MessageId, content: z.string() }),
});
/** A message sent while the agent works, held until it can take it (E2-R1: shown as "Queued"). */
export const SessionMessageQueuedEvent = SessionMessageQueuedInput.extend(assigned);
export type SessionMessageQueuedEvent = z.infer<typeof SessionMessageQueuedEvent>;

const SessionCheckInInput = z.object({
  type: z.literal('session.check_in'),
  ...onSessionStream,
  payload: z.object({
    sessionId: SessionId,
    /** The title of the tool call still in progress, when there is one ("Claude Code is waiting on <title>"). */
    waitingOn: z.string().min(1).optional(),
  }),
});
/**
 * The agent has sent nothing for a while (10 minutes) while `working`, never
 * while `waiting`: the session stays `working` and nothing times out (story
 * 2.10). Any later event of the session supersedes it.
 */
export const SessionCheckInEvent = SessionCheckInInput.extend(assigned);
export type SessionCheckInEvent = z.infer<typeof SessionCheckInEvent>;

// Permission events live on the session's stream and, like session events,
// are appended only through the session-event helper (E2-R7).

const PermissionRequestedInput = z.object({
  type: z.literal('permission.requested'),
  ...onSessionStream,
  payload: z.object({
    sessionId: SessionId,
    requestId: PermissionRequestId,
    toolCall: z.object({
      toolCallId: z.string().min(1),
      title: z.string(),
      kind: ToolKind,
      /** The command a shell tool call would run, secrets masked. */
      command: z.string().optional(),
      /**
       * It writes to, or its command names, a file that controls how the
       * agent or git runs (`.claude/`, `.git/`, `.mcp.json`, ...): it always
       * asks, whatever the caution level or rules (story 2.8, F1).
       */
      protectedPath: z.literal(true).optional(),
    }),
    /** What "Always allow" would cover; `null` when it is not offered. */
    alwaysAllowScope: AlwaysAllowScope.nullable(),
    /** The workspace's caution level when the card was shown. */
    cautionLevel: CautionLevel,
  }),
});
/** The agent asked to run a tool call; it does not run until the request is resolved (CAP-4). */
export const PermissionRequestedEvent = PermissionRequestedInput.extend(assigned);
export type PermissionRequestedEvent = z.infer<typeof PermissionRequestedEvent>;

const PermissionResolvedInput = z.object({
  type: z.literal('permission.resolved'),
  ...onSessionStream,
  payload: z.object({
    sessionId: SessionId,
    requestId: PermissionRequestId,
    decision: PermissionDecision,
    /** The user's optional reason on Deny, sent back to the agent. */
    reason: z.string().max(MAX_DENY_REASON_LENGTH).optional(),
    /** Who decided: the user on the card, a stored rule, the caution level, or the request was cancelled. */
    by: z.enum(['user', 'rule', 'caution', 'cancelled']),
    /** The always-allow rule that decided, or that `allow_always` created. */
    ruleId: PermissionRuleId.optional(),
  }),
});
/** A permission request was decided (or cancelled); the card collapses to its record line. */
export const PermissionResolvedEvent = PermissionResolvedInput.extend(assigned);
export type PermissionResolvedEvent = z.infer<typeof PermissionResolvedEvent>;

const RunCreatedInput = z.object({
  type: z.literal('run.created'),
  ...onSessionStream,
  payload: z.object({ run: Run }),
});
export const RunCreatedEvent = RunCreatedInput.extend(assigned);
export type RunCreatedEvent = z.infer<typeof RunCreatedEvent>;

const RunOutcomeChangedInput = z.object({
  type: z.literal('run.outcome_changed'),
  ...onSessionStream,
  payload: z.object({ runId: RunId, outcome: RunOutcome, previous: RunOutcome }),
});
export const RunOutcomeChangedEvent = RunOutcomeChangedInput.extend(assigned);
export type RunOutcomeChangedEvent = z.infer<typeof RunOutcomeChangedEvent>;

const onToolchainStream = { workspaceId: z.null(), streamId: z.literal(TOOLCHAIN_STREAM) };

const ToolchainInstallStartedInput = z.object({
  type: z.literal('toolchain.install_started'),
  ...onToolchainStream,
  payload: z.object({ tool: ToolName, version: z.string().min(1) }),
});
/** The user clicked Install and the download began (story 1.8). */
export const ToolchainInstallStartedEvent = ToolchainInstallStartedInput.extend(assigned);
export type ToolchainInstallStartedEvent = z.infer<typeof ToolchainInstallStartedEvent>;

const ToolchainInstallProgressInput = z.object({
  type: z.literal('toolchain.install_progress'),
  ...onToolchainStream,
  payload: z.object({
    tool: ToolName,
    bytes: z.number().int().nonnegative(),
    total: z.number().int().positive().nullable(),
  }),
});
/** Bytes downloaded so far (throttled); `total` is `null` when the server did not say. */
export const ToolchainInstallProgressEvent = ToolchainInstallProgressInput.extend(assigned);
export type ToolchainInstallProgressEvent = z.infer<typeof ToolchainInstallProgressEvent>;

const ToolchainInstallCompletedInput = z.object({
  type: z.literal('toolchain.install_completed'),
  ...onToolchainStream,
  payload: z.object({ tool: ToolName, version: z.string().min(1), source: ToolSource }),
});
/** The private copy is verified, unpacked and ready. */
export const ToolchainInstallCompletedEvent = ToolchainInstallCompletedInput.extend(assigned);
export type ToolchainInstallCompletedEvent = z.infer<typeof ToolchainInstallCompletedEvent>;

const ToolchainInstallFailedInput = z.object({
  type: z.literal('toolchain.install_failed'),
  ...onToolchainStream,
  payload: z.object({
    tool: ToolName,
    code: ToolchainErrorCode,
    reason: z.string().min(1),
    canInstall: z.boolean(),
  }),
});
/** The install failed; nothing half-installed is left behind. `reason` is plain words, no secrets. */
export const ToolchainInstallFailedEvent = ToolchainInstallFailedInput.extend(assigned);
export type ToolchainInstallFailedEvent = z.infer<typeof ToolchainInstallFailedEvent>;

const onAgentsStream = { workspaceId: z.null(), streamId: z.literal(AGENTS_STREAM) };

const AgentInstallStartedInput = z.object({
  type: z.literal('agent.install_started'),
  ...onAgentsStream,
  payload: z.object({ agentId: AgentId }),
});
/** The user clicked Install for an agent (onboarding, AD-21). */
export const AgentInstallStartedEvent = AgentInstallStartedInput.extend(assigned);
export type AgentInstallStartedEvent = z.infer<typeof AgentInstallStartedEvent>;

const AgentInstallProgressInput = z.object({
  type: z.literal('agent.install_progress'),
  ...onAgentsStream,
  payload: z.object({
    agentId: AgentId,
    /** Plain words for the step under way ("Downloading Claude Code"). */
    step: z.string().min(1),
    /** 0 to 100, or `null` when the step can't tell. */
    percent: z.number().min(0).max(100).nullable(),
  }),
});
export const AgentInstallProgressEvent = AgentInstallProgressInput.extend(assigned);
export type AgentInstallProgressEvent = z.infer<typeof AgentInstallProgressEvent>;

const AgentInstallCompletedInput = z.object({
  type: z.literal('agent.install_completed'),
  ...onAgentsStream,
  payload: z.object({ agentId: AgentId, version: z.string().min(1).optional() }),
});
export const AgentInstallCompletedEvent = AgentInstallCompletedInput.extend(assigned);
export type AgentInstallCompletedEvent = z.infer<typeof AgentInstallCompletedEvent>;

const AgentInstallFailedInput = z.object({
  type: z.literal('agent.install_failed'),
  ...onAgentsStream,
  payload: z.object({ agentId: AgentId, reason: z.string().min(1) }),
});
/** The install failed. `reason` is plain words, no secrets. */
export const AgentInstallFailedEvent = AgentInstallFailedInput.extend(assigned);
export type AgentInstallFailedEvent = z.infer<typeof AgentInstallFailedEvent>;

const AgentAuthChangedInput = z.object({
  type: z.literal('agent.auth_changed'),
  ...onAgentsStream,
  payload: z.object({
    agentId: AgentId,
    state: AgentAuthState,
    method: AgentAuthMethodKind.optional(),
    /** Plain words, when there is something to say (a failed sign-in). Never a URL, a code or a key. */
    reason: z.string().min(1).optional(),
  }),
});
/** An agent's sign-in state changed. Carries no URL, code or key (AD-15, AD-16). */
export const AgentAuthChangedEvent = AgentAuthChangedInput.extend(assigned);
export type AgentAuthChangedEvent = z.infer<typeof AgentAuthChangedEvent>;

/** Every event core may append (grows with later stories). Nothing unschematized is emitted. */
export const CoreEvent = z.discriminatedUnion('type', [
  ServerStartedEvent,
  WorkspaceCreatedEvent,
  WorkspaceHistoryDeletedEvent,
  WorkspacePermissionRuleAddedEvent,
  WorkspacePermissionRuleRemovedEvent,
  WorkspaceSettingsChangedEvent,
  SessionCreatedEvent,
  SessionStateChangedEvent,
  SessionDriverChangedEvent,
  SessionMessageDeltaEvent,
  SessionMessageCompletedEvent,
  SessionToolCallEvent,
  SessionToolCallUpdatedEvent,
  SessionResumedEvent,
  SessionMessageQueuedEvent,
  SessionCheckInEvent,
  PermissionRequestedEvent,
  PermissionResolvedEvent,
  RunCreatedEvent,
  RunOutcomeChangedEvent,
  ToolchainInstallStartedEvent,
  ToolchainInstallProgressEvent,
  ToolchainInstallCompletedEvent,
  ToolchainInstallFailedEvent,
  AgentInstallStartedEvent,
  AgentInstallProgressEvent,
  AgentInstallCompletedEvent,
  AgentInstallFailedEvent,
  AgentAuthChangedEvent,
]);
export type CoreEvent = z.infer<typeof CoreEvent>;
export type CoreEventType = CoreEvent['type'];

/** What a caller asks core to append: an event without `id`, `seq` and `at`. */
export const NewCoreEvent = z.discriminatedUnion('type', [
  ServerStartedInput,
  WorkspaceCreatedInput,
  WorkspaceHistoryDeletedInput,
  WorkspacePermissionRuleAddedInput,
  WorkspacePermissionRuleRemovedInput,
  WorkspaceSettingsChangedInput,
  SessionCreatedInput,
  SessionStateChangedInput,
  SessionDriverChangedInput,
  SessionMessageDeltaInput,
  SessionMessageCompletedInput,
  SessionToolCallInput,
  SessionToolCallUpdatedInput,
  SessionResumedInput,
  SessionMessageQueuedInput,
  SessionCheckInInput,
  PermissionRequestedInput,
  PermissionResolvedInput,
  RunCreatedInput,
  RunOutcomeChangedInput,
  ToolchainInstallStartedInput,
  ToolchainInstallProgressInput,
  ToolchainInstallCompletedInput,
  ToolchainInstallFailedInput,
  AgentInstallStartedInput,
  AgentInstallProgressInput,
  AgentInstallCompletedInput,
  AgentInstallFailedInput,
  AgentAuthChangedInput,
]);
export type NewCoreEvent = z.infer<typeof NewCoreEvent>;

/** The input for one event type, e.g. `NewEventOf<'session.message_completed'>`. */
export type NewEventOf<T extends CoreEventType> = Extract<NewCoreEvent, { type: T }>;

// ---------------------------------------------------------------------------
// WebSocket messages.
// ---------------------------------------------------------------------------

/** Reply to a client `ping`; lets a client confirm the connection is alive. */
export const PongMessage = z.object({
  type: z.literal('pong'),
  at: IsoUtcTimestamp,
});
export type PongMessage = z.infer<typeof PongMessage>;

/**
 * Sent once after the backlog of each subscription (`subscribe_install`,
 * `subscribe_workspace`, or the legacy `subscribe`): every event of that
 * scope up to now has been delivered, and what follows is live. The UI waits for it before judging
 * state that a replayed backlog could briefly misstate (the version banner).
 */
export const CaughtUpMessage = z.object({
  type: z.literal('caught_up'),
  /**
   * Which subscription caught up (E2-R8): the install-level stream, or one
   * workspace. Absent for the legacy install-wide `subscribe`.
   */
  scope: z.union([z.literal('install'), WorkspaceId]).optional(),
  /** The oldest `seq` the window sent, or `null` when it sent none. */
  oldestSeq: Seq.nullable().optional(),
  /** Whether older events exist before the window (the UI offers "Show earlier"). */
  hasEarlier: z.boolean().optional(),
});
export type CaughtUpMessage = z.infer<typeof CaughtUpMessage>;

/** Why the server is stopping: Quit from the UI, or a restart for a newer version (AD-20). */
export const StopReason = z.enum(['quit', 'restart']);
export type StopReason = z.infer<typeof StopReason>;

/**
 * Sent to every connected client just before the server stops on purpose,
 * so every open tab shows the stopped state rather than reconnecting.
 */
export const ServerStoppingMessage = z.object({
  type: z.literal('server.stopping'),
  reason: StopReason,
});
export type ServerStoppingMessage = z.infer<typeof ServerStoppingMessage>;

/** The client message types that carry a request the server can refuse with `request_failed`. */
export const CLIENT_REQUEST_TYPES = ['subscribe_install', 'subscribe_workspace', 'unsubscribe_workspace', 'page_history'] as const;
export const ClientRequestType = z.enum(CLIENT_REQUEST_TYPES);
export type ClientRequestType = z.infer<typeof ClientRequestType>;

/**
 * One page of older history, the answer to `page_history` (E2-R8): events
 * before `beforeSeq`, oldest first. `hasMore` says whether still older ones exist.
 */
export const HistoryPageMessage = z.object({
  type: z.literal('history_page'),
  requestId: z.string().min(1).max(128),
  workspaceId: WorkspaceId,
  events: z.array(CoreEvent).max(MAX_PAGE_EVENTS),
  hasMore: z.boolean(),
});
export type HistoryPageMessage = z.infer<typeof HistoryPageMessage>;

/** The server could not do what a client message asked; `code` is one of the API's error codes. */
export const RequestFailedMessage = z.object({
  type: z.literal('request_failed'),
  for: ClientRequestType,
  requestId: z.string().min(1).max(128).optional(),
  workspaceId: WorkspaceId.optional(),
  code: ApiErrorCode,
  message: z.string().min(1),
});
export type RequestFailedMessage = z.infer<typeof RequestFailedMessage>;

/**
 * Every message the server may send over `/ws`: logged events, `pong`,
 * `caught_up`, `server.stopping`, `history_page` and `request_failed`.
 */
export const ServerMessage = z.discriminatedUnion('type', [
  ...CoreEvent.options,
  PongMessage,
  CaughtUpMessage,
  ServerStoppingMessage,
  HistoryPageMessage,
  RequestFailedMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** A client asking the server to answer with `pong`. */
export const PingMessage = z.object({
  type: z.literal('ping'),
});
export type PingMessage = z.infer<typeof PingMessage>;

/**
 * Deprecated (story 2.9): the web sends `subscribe_install` and
 * `subscribe_workspace` instead. Stream every event with `seq > afterSeq`,
 * then every new event live. Connecting and catching up are the same call: a
 * new client sends `0`, a reconnecting one sends the last `seq` it received.
 * Sending it again replaces the previous subscription. Still served.
 */
export const SubscribeMessage = z.object({
  type: z.literal('subscribe'),
  afterSeq: z.number().int().nonnegative(),
});
export type SubscribeMessage = z.infer<typeof SubscribeMessage>;

/**
 * Stream the install-level events (`workspaceId: null`: server, toolchain,
 * agents) and every `workspace.created` (so a project added in another tab
 * is seen) with `seq > afterSeq`, then live (E2-R8). Replaces an earlier
 * `subscribe_install`.
 */
export const SubscribeInstallMessage = z.object({
  type: z.literal('subscribe_install'),
  afterSeq: z.number().int().nonnegative(),
});
export type SubscribeInstallMessage = z.infer<typeof SubscribeInstallMessage>;

/**
 * Stream one workspace's events, then live (E2-R8). With `afterSeq` (a
 * reconnect) every event after it; without, only the most recent `window`
 * events (default {@link DEFAULT_WINDOW_EVENTS}). Older history is paged with
 * `page_history`. Ends with a `caught_up` naming the workspace.
 */
export const SubscribeWorkspaceMessage = z.object({
  type: z.literal('subscribe_workspace'),
  workspaceId: WorkspaceId,
  afterSeq: z.number().int().nonnegative().optional(),
  window: z.number().int().positive().max(MAX_PAGE_EVENTS).optional(),
});
export type SubscribeWorkspaceMessage = z.infer<typeof SubscribeWorkspaceMessage>;

/** Stop streaming one workspace's events. */
export const UnsubscribeWorkspaceMessage = z.object({
  type: z.literal('unsubscribe_workspace'),
  workspaceId: WorkspaceId,
});
export type UnsubscribeWorkspaceMessage = z.infer<typeof UnsubscribeWorkspaceMessage>;

/**
 * Asks for older history ("Show earlier"): up to `limit` events of the
 * workspace (or of one of its sessions) with `seq < beforeSeq`. Answered by
 * `history_page` with the same `requestId`, or `request_failed`.
 */
export const PageHistoryMessage = z.object({
  type: z.literal('page_history'),
  requestId: z.string().min(1).max(128),
  workspaceId: WorkspaceId,
  sessionId: SessionId.optional(),
  beforeSeq: Seq,
  limit: z.number().int().positive().max(MAX_PAGE_EVENTS),
});
export type PageHistoryMessage = z.infer<typeof PageHistoryMessage>;

/**
 * Every message a client may send over `/ws`. The legacy install-wide
 * `subscribe` is deprecated: it keeps working, but the web no longer sends it
 * (story 2.9).
 */
export const ClientMessage = z.discriminatedUnion('type', [
  PingMessage,
  SubscribeMessage,
  SubscribeInstallMessage,
  SubscribeWorkspaceMessage,
  UnsubscribeWorkspaceMessage,
  PageHistoryMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
