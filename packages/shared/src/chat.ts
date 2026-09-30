import { z } from 'zod';
import { AlwaysAllowScope, CautionLevel, MAX_DENY_REASON_LENGTH, MessageId, PermissionDecision } from './events.js';
import { Session, Workspace } from './entities.js';
import { PermissionRuleId, WorkspaceId } from './ids.js';
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
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

export const WorkspaceResponse = z.object({ workspace: Workspace });
export type WorkspaceResponse = z.infer<typeof WorkspaceResponse>;

/** `POST /api/v1/workspaces/:wsId/sessions`. Only chat sessions are created this way so far. */
export const CreateSessionRequest = z.object({
  kind: z.literal('chat').default('chat'),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const SessionResponse = z.object({ session: Session });
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

/** A workspace's settings (Workspace settings page). */
export const WorkspaceSettings = z.object({ cautionLevel: CautionLevel });
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

/** `GET` and `PATCH /api/v1/workspaces/:wsId/settings`. */
export const WorkspaceSettingsResponse = z.object({ settings: WorkspaceSettings });
export type WorkspaceSettingsResponse = z.infer<typeof WorkspaceSettingsResponse>;

/** `PATCH /api/v1/workspaces/:wsId/settings`: the fields to change. */
export const UpdateWorkspaceSettingsRequest = WorkspaceSettings.partial().refine(
  (settings) => Object.keys(settings).length > 0,
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
