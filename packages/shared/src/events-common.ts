import { z } from 'zod';

/**
 * The event log's common parts (moved from `events.ts` in story 10.8, which
 * re-exports them): the install-wide position, the install-level streams,
 * the page sizes, and the enums event payloads share.
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
 * The stream of install-level settings events (`workspaceId: null`):
 * Developer mode, which the server keeps and enforces.
 */
export const SETTINGS_STREAM = 'settings';

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

/**
 * What a message sent while the agent works does (send now or wait,
 * 2026-10-04): `wait` holds it until the turn ends (story 2.10, the
 * default); `now` sends it right away, into the running turn when the agent
 * can take it there, else by stopping the current step first.
 */
export const WHILE_WORKING = ['wait', 'now'] as const;
export const WhileWorking = z.enum(WHILE_WORKING);
export type WhileWorking = z.infer<typeof WhileWorking>;
export const DEFAULT_WHILE_WORKING: WhileWorking = 'wait';

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

/**
 * Why a session went to `error`, when it is one the UI acts on
 * (`auth_required`: Sign in again; `usage_limit`: the agent ran out of usage,
 * so the chat offers to continue with another agent).
 */
export const SESSION_ERROR_CODES = ['agent_unavailable', 'agent_failed', 'auth_required', 'usage_limit'] as const;
export const SessionErrorCode = z.enum(SESSION_ERROR_CODES);
export type SessionErrorCode = z.infer<typeof SessionErrorCode>;

/** An agent's sign-in state (CAP-16). */
export const AGENT_AUTH_STATES = ['signed_in', 'needs_sign_in', 'signing_in', 'failed'] as const;
export const AgentAuthState = z.enum(AGENT_AUTH_STATES);
export type AgentAuthState = z.infer<typeof AgentAuthState>;

/** How an agent is signed in: the user's own subscription login, or an API key from the keychain (AD-16). */
export const AgentAuthMethodKind = z.enum(['subscription', 'api_key']);
export type AgentAuthMethodKind = z.infer<typeof AgentAuthMethodKind>;
