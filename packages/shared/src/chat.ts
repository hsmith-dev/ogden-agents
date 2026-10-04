import { z } from 'zod';
import { BmadPieceSet } from './bmad.js';
import { AgentId, AlwaysAllowScope, CautionLevel, MAX_DENY_REASON_LENGTH, MessageId, PermissionDecision } from './events.js';
import { PermissionMode, Session, Workspace } from './entities.js';
import { PermissionRuleId, WorkspaceId } from './ids.js';
import { SessionTerminal } from './terminal.js';
import { IsoUtcTimestamp } from './time.js';

/**
 * The chat REST contract (story 2.2, the tracer bullet): create a workspace
 * from a repo path, create a chat session in it, and send a message. Replies
 * and state never come back in these responses; they arrive through the event
 * log (AD-5). Routes are in `API_ROUTES`.
 */

/** `POST /api/v1/workspaces`. `path` is a folder on this computer; the server canonicalizes it (AD-2). */
export const CreateWorkspaceRequest = z.object({
  path: z.string().trim().min(1, 'Enter the path of a folder on this computer.'),
  /**
   * The BMad pieces a newly added project starts with (story 10.2's
   * contract; entry 10.4 applies it, from Welcome's first-project answer).
   * Omitted: the app-wide default. Ignored for a project that already exists.
   */
  bmadPieces: BmadPieceSet.optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

export const WorkspaceResponse = z.object({ workspace: Workspace });
export type WorkspaceResponse = z.infer<typeof WorkspaceResponse>;

/**
 * `POST /api/v1/workspaces/:wsId/sessions`. Only chat sessions are created
 * this way so far. `agentId` picks the chat's agent (epic 6); omitted, the
 * install's default agent (`ChatAgentsResponse.defaultAgentId`).
 */
export const CreateSessionRequest = z.object({
  kind: z.literal('chat').default('chat'),
  agentId: AgentId.optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

/**
 * One agent a chat can be started with (epic 6, E6-R2): agent-neutral data,
 * never a branch on an id. `permissionModes` are the modes it declares, Ask
 * always among them.
 */
export const ChatAgent = z.object({
  agentId: AgentId,
  /** The agent's product name, as the UI names it. */
  displayName: z.string().min(1),
  permissionModes: z.array(PermissionMode).min(1),
});
export type ChatAgent = z.infer<typeof ChatAgent>;

/** `GET /api/v1/chat-agents`: the agents a chat can be started with, in order, and the one a new chat gets when none is picked. */
export const ChatAgentsResponse = z.object({
  agents: z.array(ChatAgent).min(1),
  defaultAgentId: AgentId,
});
export type ChatAgentsResponse = z.infer<typeof ChatAgentsResponse>;

/**
 * One permission mode as the chat's mode picker offers it: whether the
 * session's agent offers it, and if not, why, in one plain sentence.
 */
export const SessionPermissionModeOption = z.object({
  mode: PermissionMode,
  available: z.boolean(),
  reason: z.string().min(1).optional(),
});
export type SessionPermissionModeOption = z.infer<typeof SessionPermissionModeOption>;

/**
 * A session. `GET` adds `terminal`: whether its agent's own terminal can work
 * here (story 3.2), and `permissionModes`: every mode, in order, and whether
 * its agent offers it; the other routes that answer a session leave them out.
 */
export const SessionResponse = z.object({
  session: Session,
  terminal: SessionTerminal.optional(),
  permissionModes: z.array(SessionPermissionModeOption).optional(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** The longest message the composer may send, in characters. */
export const MAX_MESSAGE_LENGTH = 100_000;

/** `POST /api/v1/workspaces/:wsId/sessions/:sesId/messages`. */
export const SendMessageRequest = z.object({
  text: z
    .string()
    .refine((text) => text.trim().length > 0, 'Write a message first.')
    .pipe(z.string().max(MAX_MESSAGE_LENGTH, `A message can be at most ${MAX_MESSAGE_LENGTH} characters.`)),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/**
 * The user's message, as `session.message_completed` carries it (role
 * `user`). `queued` is `true` when the agent was still working and the
 * message waits its turn (`session.message_queued`; E2-R1, story 2.10).
 */
export const SendMessageResponse = z.object({ messageId: MessageId, queued: z.boolean() });
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

// ---------------------------------------------------------------------------
// Workspaces and sessions (story 2.3 contracts; filled by 2.5, 2.8, 2.10).
// ---------------------------------------------------------------------------

/** `GET /api/v1/workspaces`: every workspace of this install. */
export const WorkspacesResponse = z.object({ workspaces: z.array(Workspace) });
export type WorkspacesResponse = z.infer<typeof WorkspacesResponse>;

/** `GET /api/v1/workspaces/:wsId/sessions`: the workspace's sessions (the Chats list). */
export const SessionsResponse = z.object({ sessions: z.array(Session) });
export type SessionsResponse = z.infer<typeof SessionsResponse>;

/** `GET /api/v1/folders?path=`: the query. Without `path`, the user's home folder. */
export const FolderListingQuery = z.object({ path: z.string().min(1).optional() });
export type FolderListingQuery = z.infer<typeof FolderListingQuery>;

/** One subfolder in a {@link FolderListing}. */
export const FolderEntry = z.object({
  name: z.string().min(1),
  /** The folder's absolute path. */
  path: z.string().min(1),
});
export type FolderEntry = z.infer<typeof FolderEntry>;

/**
 * The server-side folder browser for Add project (a browser page can't hand
 * the server a local path): the folder shown, its parent (`null` at the top
 * of the disk), and its subfolders.
 */
export const FolderListing = z.object({
  path: z.string().min(1),
  parent: z.string().min(1).nullable(),
  entries: z.array(FolderEntry),
});
export type FolderListing = z.infer<typeof FolderListing>;

/** `POST /api/v1/folders`: Start a new project folder named `name` inside `parent`. */
export const CreateFolderRequest = z.object({
  parent: z.string().trim().min(1, 'Choose where the new folder goes.'),
  name: z
    .string()
    .trim()
    .min(1, 'Name the new folder.')
    .max(255, 'A folder name can be at most 255 characters.')
    .refine((name) => !/[\\/]/.test(name) && name !== '.' && name !== '..', 'A folder name cannot contain slashes.'),
});
export type CreateFolderRequest = z.infer<typeof CreateFolderRequest>;

/** The new folder's absolute path. */
export const CreateFolderResponse = z.object({ path: z.string().min(1) });
export type CreateFolderResponse = z.infer<typeof CreateFolderResponse>;

/** `DELETE /api/v1/workspaces/:wsId/history`: what was deleted; the workspace itself stays. */
export const HistoryDeletedResponse = z.object({
  deletedEvents: z.number().int().nonnegative(),
  deletedSessions: z.number().int().nonnegative(),
  deletedRuns: z.number().int().nonnegative(),
});
export type HistoryDeletedResponse = z.infer<typeof HistoryDeletedResponse>;

/**
 * A workspace's settings (Workspace settings page): its caution level, the
 * BMad pieces it has on (AD-22), and whether the user trusted the project's
 * own BMad Method scripts to run (story 4.2). `bmadScriptsTrusted` is
 * optional when parsed (an older server's answer reads as not trusted) and
 * always present once parsed; core always sends it. It changes only through
 * `PUT …/bmad/script-trust`, never through `PATCH` settings.
 */
export const WorkspaceSettings = z.object({ cautionLevel: CautionLevel, bmadPieces: BmadPieceSet, bmadScriptsTrusted: z.boolean().default(false) });
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

/** `GET` and `PATCH /api/v1/workspaces/:wsId/settings`. */
export const WorkspaceSettingsResponse = z.object({ settings: WorkspaceSettings });
export type WorkspaceSettingsResponse = z.infer<typeof WorkspaceSettingsResponse>;

/**
 * `PATCH /api/v1/workspaces/:wsId/settings`: the fields to change. The pieces
 * must satisfy the dependency rule (story 10.2); turning on a piece this
 * install doesn't ship is refused by core with `feature_unavailable`.
 */
export const UpdateWorkspaceSettingsRequest = z.object({ cautionLevel: CautionLevel.optional(), bmadPieces: BmadPieceSet.optional() }).refine(
  (settings) => settings.cautionLevel !== undefined || settings.bmadPieces !== undefined,
  'Choose a setting to change.',
);
export type UpdateWorkspaceSettingsRequest = z.infer<typeof UpdateWorkspaceSettingsRequest>;

// ---------------------------------------------------------------------------
// Permissions (story 2.3 contracts; filled by 2.6).
// ---------------------------------------------------------------------------

/** `POST /api/v1/workspaces/:wsId/sessions/:sesId/permissions/:requestId`: the user's answer on the card. */
export const PermissionDecisionRequest = z.object({
  decision: PermissionDecision,
  /** Optional reason on Deny, sent back to the agent. */
  reason: z
    .string()
    .max(MAX_DENY_REASON_LENGTH, `A reason can be at most ${MAX_DENY_REASON_LENGTH} characters.`)
    .optional(),
});
export type PermissionDecisionRequest = z.infer<typeof PermissionDecisionRequest>;

/** An always-allow rule: stored and enforced in core, scoped to one workspace, and undoable (E2-R3). */
export const PermissionRule = z.object({
  id: PermissionRuleId,
  workspaceId: WorkspaceId,
  scope: AlwaysAllowScope,
  createdAt: IsoUtcTimestamp,
});
export type PermissionRule = z.infer<typeof PermissionRule>;

/** `GET /api/v1/workspaces/:wsId/permission-rules`. */
export const PermissionRulesResponse = z.object({ rules: z.array(PermissionRule) });
export type PermissionRulesResponse = z.infer<typeof PermissionRulesResponse>;

// ---------------------------------------------------------------------------
// Permission modes and Developer mode.
// ---------------------------------------------------------------------------

/**
 * `PUT /api/v1/workspaces/:wsId/sessions/:sesId/permission-mode`. `confirm`
 * says the user confirmed the red warning: the server refuses `skip_all`
 * without it.
 */
export const SetPermissionModeRequest = z.object({ mode: PermissionMode, confirm: z.boolean().optional() });
export type SetPermissionModeRequest = z.infer<typeof SetPermissionModeRequest>;

/**
 * `GET` and `PUT /api/v1/settings/developer-mode`. `everSet` says whether
 * Developer mode was ever turned on or off on this install (a browser carries
 * its old browser-only "on" over only when it never was).
 */
export const DeveloperModeResponse = z.object({ developerMode: z.boolean(), everSet: z.boolean().optional() });
export type DeveloperModeResponse = z.infer<typeof DeveloperModeResponse>;

/** `PUT /api/v1/settings/developer-mode`. */
export const SetDeveloperModeRequest = z.object({ developerMode: z.boolean() });
export type SetDeveloperModeRequest = z.infer<typeof SetDeveloperModeRequest>;
