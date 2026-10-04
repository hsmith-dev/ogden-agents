import { z } from 'zod';
import { PermissionMode, Session, SessionDriver, SessionState } from './entities.js';
import { AlwaysAllowScope, CautionLevel, MAX_DENY_REASON_LENGTH, PermissionDecision, PermissionRequestId, SessionErrorCode, ToolCallDiff, ToolCallStatus, ToolKind } from './events-common.js';
import { assigned, onSessionStream } from './events-envelope.js';
import { PermissionRuleId, SessionId } from './ids.js';
import { CatalogNext, RepoRelativePath } from './planning.js';
import { DriverChangeCause } from './terminal.js';

/**
 * Session and permission event schemas (moved from `events.ts` in story
 * 10.8, which re-exports the events and their parts; the `*Input` schemas
 * stay internal to the event modules).
 */

export const SessionCreatedInput = z.object({
  type: z.literal('session.created'),
  ...onSessionStream,
  payload: z.object({ session: Session }),
});
export const SessionCreatedEvent = SessionCreatedInput.extend(assigned);
export type SessionCreatedEvent = z.infer<typeof SessionCreatedEvent>;

export const SessionStateChangedInput = z.object({
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

export const SessionDriverChangedInput = z.object({
  type: z.literal('session.driver_changed'),
  ...onSessionStream,
  payload: z.object({
    sessionId: SessionId,
    driver: SessionDriver,
    previous: SessionDriver,
    /** Why it changed (story 3.2). Absent on events from before 3.2. */
    cause: DriverChangeCause.optional(),
  }),
});
/** A session's driver changed (AD-6). */
export const SessionDriverChangedEvent = SessionDriverChangedInput.extend(assigned);
export type SessionDriverChangedEvent = z.infer<typeof SessionDriverChangedEvent>;

/**
 * Why a chat's permission mode changed: the user chose it (`user`), Developer
 * mode was turned off while it skipped checks (`developer_mode_off`), a server
 * start set it back to Ask (`restart`: no mode but Ask outlives the run it was
 * chosen in), or the agent reported a mode the chat didn't choose (`agent`).
 */
export const PERMISSION_MODE_CHANGE_CAUSES = ['user', 'developer_mode_off', 'restart', 'agent'] as const;
export const PermissionModeChangeCause = z.enum(PERMISSION_MODE_CHANGE_CAUSES);
export type PermissionModeChangeCause = z.infer<typeof PermissionModeChangeCause>;

export const SessionPermissionModeChangedInput = z.object({
  type: z.literal('session.permission_mode_changed'),
  ...onSessionStream,
  payload: z.object({
    sessionId: SessionId,
    mode: PermissionMode,
    previous: PermissionMode,
    cause: PermissionModeChangeCause,
    /** Why, in plain words for the user, when there is something to say. Never a secret. */
    reason: z.string().min(1).optional(),
  }),
});
/** A chat's permission mode changed (core is the only one that changes it). */
export const SessionPermissionModeChangedEvent = SessionPermissionModeChangedInput.extend(assigned);
export type SessionPermissionModeChangedEvent = z.infer<typeof SessionPermissionModeChangedEvent>;

/** Identifies one message within a session's stream. */
export const MessageId = z.string().min(1);
export type MessageId = z.infer<typeof MessageId>;

export const MessageRole = z.enum(['user', 'agent']);
export type MessageRole = z.infer<typeof MessageRole>;

export const SessionMessageDeltaInput = z.object({
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

export const SessionMessageCompletedInput = z.object({
  type: z.literal('session.message_completed'),
  ...onSessionStream,
  payload: z.object({
    messageId: MessageId,
    role: MessageRole,
    content: z.string(),
    /**
     * Set on a user message that was not typed in the chat's composer: the
     * reason they gave with a Deny, which core sent for the user
     * (`deny_reason`; Try again never resends it as a plain message, 9.4
     * review F4), or one typed in the agent's own terminal and imported after
     * switching back (`terminal`, story 3.2; shown "from terminal").
     */
    origin: z.enum(['deny_reason', 'terminal']).optional(),
  }),
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

export const SessionToolCallInput = z.object({
  type: z.literal('session.tool_call'),
  ...onSessionStream,
  payload: toolCallPayload,
});
/** The agent started a tool call (read a file, run a command, …). */
export const SessionToolCallEvent = SessionToolCallInput.extend(assigned);
export type SessionToolCallEvent = z.infer<typeof SessionToolCallEvent>;

export const SessionToolCallUpdatedInput = z.object({
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

export const SessionResumedInput = z.object({
  type: z.literal('session.resumed'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, via: ResumedVia }),
});
/** A chat was reopened after its agent's process was gone ("Resumed from history" when `via` is `transcript`). */
export const SessionResumedEvent = SessionResumedInput.extend(assigned);
export type SessionResumedEvent = z.infer<typeof SessionResumedEvent>;

export const SessionMessageQueuedInput = z.object({
  type: z.literal('session.message_queued'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, messageId: MessageId, content: z.string() }),
});
/** A message sent while the agent works, held until it can take it (E2-R1: shown as "Queued"). */
export const SessionMessageQueuedEvent = SessionMessageQueuedInput.extend(assigned);
export type SessionMessageQueuedEvent = z.infer<typeof SessionMessageQueuedEvent>;

export const SessionCheckInInput = z.object({
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

export const SessionDocumentWrittenInput = z.object({
  type: z.literal('session.document_written'),
  ...onSessionStream,
  payload: z.object({
    /** The document, relative to the repo, `/`-separated (inside the project's output folder). */
    path: RepoRelativePath,
    /** The write tool call that wrote it, when known. */
    toolCallId: z.string().min(1).nullable(),
    /** The next suggested step's skill and button label, when the catalog names one. */
    next: CatalogNext.nullable(),
  }),
});
/**
 * A planning session wrote a BMad Method document (story 4.2's contract;
 * entry 4.7 appends it): the transcript shows a document card with Open and
 * the next suggested step (E4-R6).
 */
export const SessionDocumentWrittenEvent = SessionDocumentWrittenInput.extend(assigned);
export type SessionDocumentWrittenEvent = z.infer<typeof SessionDocumentWrittenEvent>;

export const SessionAgentStartingInput = z.object({
  type: z.literal('session.agent_starting'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId }),
});
/**
 * The session's agent is taking a while to start (epic 6 entry 5: an agent
 * whose every start takes many seconds, such as Antigravity on Windows): the
 * chat shows it as starting, not stuck, until `session.agent_started`, or
 * until the session leaves `working`. Appended only after a start has run
 * for a moment, so a quick start adds nothing.
 */
export const SessionAgentStartingEvent = SessionAgentStartingInput.extend(assigned);
export type SessionAgentStartingEvent = z.infer<typeof SessionAgentStartingEvent>;

export const SessionAgentStartedInput = z.object({
  type: z.literal('session.agent_started'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId }),
});
/** The agent a `session.agent_starting` announced is started (or its start ended): the starting notice goes. */
export const SessionAgentStartedEvent = SessionAgentStartedInput.extend(assigned);
export type SessionAgentStartedEvent = z.infer<typeof SessionAgentStartedEvent>;

// Permission events live on the session's stream and, like session events,
// are appended only through the session-event helper (E2-R7).

export const PermissionRequestedInput = z.object({
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
    /**
     * The chat's permission mode when the card was shown. In `skip_all` no
     * caution level or rule answers it, and Always allow is never offered.
     * Absent on events from before permission modes (they were `ask`).
     */
    permissionMode: PermissionMode.optional(),
  }),
});
/** The agent asked to run a tool call; it does not run until the request is resolved (CAP-4). */
export const PermissionRequestedEvent = PermissionRequestedInput.extend(assigned);
export type PermissionRequestedEvent = z.infer<typeof PermissionRequestedEvent>;

export const PermissionResolvedInput = z.object({
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
