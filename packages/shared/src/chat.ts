import { z } from 'zod';
import { BmadPieceSet } from './bmad.js';
import { AgentAuthMethodKind, AgentAuthState, AgentId, AlwaysAllowScope, CautionLevel, MAX_DENY_REASON_LENGTH, MAX_HANDOFF_BRIEF_CHARS, MessageId, PermissionDecision, WhileWorking } from './events.js';
import { AgentModel, DefaultModeNotice, ModelId, PermissionMode, Session, Workspace } from './entities.js';
import { PermissionRuleId, WorkspaceId } from './ids.js';
import { OrchestrationMode } from './orchestration-run.js';
import { AgentInstallState } from './setup.js';
import { TeamRoster } from './team.js';
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
  /**
   * The model the chat starts on (story 11; an agent handoff passes the
   * target's): the agent's own id, or `null` for its own choice. Omitted: the
   * project's default for the agent, else the install's, else `null`.
   */
  model: ModelId.nullable().optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

/**
 * One way an agent signs in, as the agent list names it (epic 6 contract,
 * 6.3): the user's own account (`subscription`), or an API key. `label` is
 * the agent's own words ("Sign in with your account").
 */
export const AgentSignInMethod = z.object({ kind: AgentAuthMethodKind, label: z.string().min(1) });
export type AgentSignInMethod = z.infer<typeof AgentSignInMethod>;

/**
 * What the user does about an agent a new chat is refused for (6.3): install
 * it or sign in to it (Settings → Agents), or trust the project.
 */
export const AGENT_ACTIONS = ['install', 'sign_in', 'trust_project'] as const;
export const AgentAction = z.enum(AGENT_ACTIONS);
export type AgentAction = z.infer<typeof AgentAction>;

/** Why a new chat with an agent is refused on this install right now, in plain words, and what fixes it (6.3). */
export const AgentUnavailable = z.object({
  code: z.enum(['agent_not_installed', 'agent_signed_out', 'project_not_trusted']),
  reason: z.string().min(1),
  action: AgentAction,
});
export type AgentUnavailable = z.infer<typeof AgentUnavailable>;

/**
 * One agent a chat can be started with (epic 6, E6-R2; frozen in 6.3):
 * agent-neutral data, never a branch on an id. `permissionModes` are the
 * modes it declares, Ask always among them. `install` and `auth` are its
 * setup as last read; `unavailable` says why a new chat with it is refused
 * now (absent: it can be started). `terminalResume`: its own CLI can take a
 * chat over (the driver toggle). `needsProjectTrust`: it runs the project's
 * own agent settings or hooks, so a project must be trusted first.
 */
export const ChatAgent = z.object({
  agentId: AgentId,
  /** The agent's product name, as the UI names it. */
  displayName: z.string().min(1),
  /** Who makes it ("Anthropic"), for the agent card. */
  provider: z.string().min(1),
  signInMethods: z.array(AgentSignInMethod),
  /** Plain words on what its API key looks like, when it takes one ("Starts with sk-ant-"). Never a key. */
  apiKeyFormat: z.string().min(1).optional(),
  /** What the agent calls its key in plain words, when it is not "API key" (Grok: "xAI API access token"). Never a key. */
  apiKeyName: z.string().min(1).max(60).optional(),
  install: AgentInstallState,
  auth: AgentAuthState,
  terminalResume: z.boolean(),
  needsProjectTrust: z.boolean(),
  /** `true` for an agent that needs no account and no key (epic 14: the Local model): its card shows its endpoint's state, not a sign in. */
  noAccount: z.boolean().optional(),
  /**
   * Present for an agent its vendor's terms allow only a person to drive
   * (epic 15): the plain sentence. It is never a worker or asked by a manager.
   */
  interactiveOnly: z.string().min(1).optional(),
  permissionModes: z.array(PermissionMode).min(1),
  unavailable: AgentUnavailable.optional(),
  /**
   * The models it offers (story 11), as it last listed them on this install,
   * or as its descriptor declares them; absent until it has listed any.
   */
  models: z.array(AgentModel).optional(),
  /** The model new chats with it start on, install-wide (Settings → Agents); absent: its own choice. */
  defaultModel: ModelId.optional(),
});
export type ChatAgent = z.infer<typeof ChatAgent>;

/**
 * `GET /api/v1/chat-agents`: the agents a chat can be started with, in
 * order, and the install's default agent: the one a new chat gets when none
 * is picked in a project with no default of its own, and the agent of every
 * session stored before agents could be chosen.
 */
export const ChatAgentsResponse = z.object({
  agents: z.array(ChatAgent).min(1),
  defaultAgentId: AgentId,
});
export type ChatAgentsResponse = z.infer<typeof ChatAgentsResponse>;

/**
 * The plain reason a chat with an agent that runs the project's own agent
 * settings or hooks is refused in a project that isn't trusted (6.3's
 * `project_not_trusted`), shared so the picker says what the server says.
 */
export const projectNotTrustedReason = (name: string) => `${name} uses this project's own agent settings, so trust the project before starting a ${name} chat.`;

/**
 * One permission mode as the chat's mode picker offers it: whether the
 * session's agent offers it, and if not, why, in one plain sentence.
 */
export const SessionPermissionModeOption = z.object({
  mode: PermissionMode,
  available: z.boolean(),
  reason: z.string().min(1).optional(),
  /**
   * On the chat's current mode when its agent takes a mode only when a chat
   * starts and the chat has started (epic 12, 12.3): the mode is fixed for
   * this chat, and every other mode says why it can't be chosen.
   */
  fixed: z.boolean().optional(),
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
  /**
   * The models the chat's picker offers (story 11; `GET` only): its agent
   * session's list when it started this run, else the agent's last list, else
   * `null` (not known yet). `current` is the model the agent reported it runs
   * on, when it said.
   */
  models: z.object({ available: z.array(AgentModel).nullable(), current: ModelId.optional() }).optional(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** The longest message the composer may send, in characters. */
export const MAX_MESSAGE_LENGTH = 100_000;

/** A message's text: not blank, at most `MAX_MESSAGE_LENGTH` characters. */
const MessageText = z
  .string()
  .refine((text) => text.trim().length > 0, 'Write a message first.')
  .pipe(z.string().max(MAX_MESSAGE_LENGTH, `A message can be at most ${MAX_MESSAGE_LENGTH} characters.`));

/**
 * `POST /api/v1/workspaces/:wsId/sessions/:sesId/messages`. `delivery` is
 * what the message does if the agent is working (send now or wait): absent
 * means `wait`, as before. The composer always says which the user chose.
 */
export const SendMessageRequest = z.object({ text: MessageText, delivery: WhileWorking.optional() });
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/**
 * The user's message, as `session.message_completed` carries it (role
 * `user`). `queued` is `true` when the agent was still working and the
 * message waits its turn (`session.message_queued`; E2-R1, story 2.10).
 */
export const SendMessageResponse = z.object({ messageId: MessageId, queued: z.boolean() });
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

// ---------------------------------------------------------------------------
// Handoff: continuing a chat with another agent (user decision 2026-10-04).
// ---------------------------------------------------------------------------

/** The message the handoff dialog starts with, for the new agent. */
export const DEFAULT_HANDOFF_MESSAGE = 'Please continue where we left off.';

/** `GET …/sessions/:sesId/handoff?agentId=`: which agent the chat would go to. */
export const HandoffPreviewQuery = z.object({ agentId: AgentId });
export type HandoffPreviewQuery = z.infer<typeof HandoffPreviewQuery>;

/**
 * What continuing the chat with `agent` would send, before anything is sent:
 * the brief Ogden built from the chat's own events (secrets masked, at most
 * `maxChars`), who receives it (`provider`, named in the confirmation), the
 * chat's permission mode afterwards and, when it falls back to Ask, why
 * (`modeNote`), and whether the agent reopens a session it had in this chat
 * (`resumes`: the brief then covers only what happened since it left).
 */
export const HandoffPreviewResponse = z.object({
  agent: z.object({ agentId: AgentId, displayName: z.string().min(1), provider: z.string().min(1) }),
  brief: z.string().max(MAX_HANDOFF_BRIEF_CHARS),
  maxChars: z.number().int().positive().max(MAX_HANDOFF_BRIEF_CHARS),
  permissionMode: PermissionMode,
  modeNote: z.string().min(1).optional(),
  resumes: z.boolean(),
  /**
   * The server's proof that this exact brief was shown for this agent and
   * chat: single-use, short-lived, and required by the handoff. An edited
   * brief gets its own with `POST …/handoff/preview`.
   */
  previewToken: z.string().min(32).max(128),
});
export type HandoffPreviewResponse = z.infer<typeof HandoffPreviewResponse>;

/**
 * `POST …/handoff/preview`: the preview again for the brief as the user
 * edited it (masked, refused over the agent's budget), with a token for it.
 */
export const HandoffBriefPreviewRequest = z.object({
  agentId: AgentId,
  brief: z.string().max(MAX_HANDOFF_BRIEF_CHARS, `A handoff brief can be at most ${MAX_HANDOFF_BRIEF_CHARS} characters.`),
});
export type HandoffBriefPreviewRequest = z.infer<typeof HandoffBriefPreviewRequest>;

/**
 * `POST …/sessions/:sesId/handoff`: continue the chat with `agentId`, telling
 * it `brief` (as the user edited it; the server masks it again and refuses
 * one over the agent's budget) and then `message`. `previewToken` must be the
 * unused, unexpired token of a preview of this same masked brief, agent and
 * chat, or it is refused (409 `handoff_not_previewed`).
 */
export const HandoffRequest = z.object({
  agentId: AgentId,
  /** The token of the preview that showed exactly this brief (masked) for this agent and chat. */
  previewToken: z.string().min(1).max(128),
  brief: z.string().max(MAX_HANDOFF_BRIEF_CHARS, `A handoff brief can be at most ${MAX_HANDOFF_BRIEF_CHARS} characters.`),
  message: z
    .string()
    .refine((text) => text.trim().length > 0, 'Write a message for the agent first.')
    .pipe(z.string().max(MAX_MESSAGE_LENGTH, `A message can be at most ${MAX_MESSAGE_LENGTH} characters.`)),
  /**
   * The model the chat runs on with its new agent (story 11; `null`: the
   * agent's own choice). Absent: the project's default for that agent, else
   * the install's, else the agent's own choice.
   */
  model: ModelId.nullable().optional(),
});
export type HandoffRequest = z.infer<typeof HandoffRequest>;

/** The chat with its new agent, and the user's message sent to it. */
export const HandoffResponse = z.object({ session: Session, messageId: MessageId });
export type HandoffResponse = z.infer<typeof HandoffResponse>;

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
 * BMad pieces it has on (AD-22), whether the user trusted the project's own
 * BMad Method scripts to run (story 4.2), and (epic 6 contract, 6.3; kept
 * from entry 6) the agent its new chats preselect. `bmadScriptsTrusted` is
 * optional when parsed (an older server's answer reads as not trusted) and
 * always present once parsed; core always sends it. It changes only through
 * `PUT …/bmad/script-trust`, never through `PATCH` settings.
 * `defaultAgentId` absent: the install's default agent
 * (`ChatAgentsResponse.defaultAgentId`).
 */
export const WorkspaceSettings = z.object({
  cautionLevel: CautionLevel,
  bmadPieces: BmadPieceSet,
  bmadScriptsTrusted: z.boolean().default(false),
  defaultAgentId: AgentId.optional(),
  /**
   * The mode new chats in this project start in (default permission mode).
   * Absent: Ask (core leaves it out for plain Ask with no notice, and an
   * older server never sends it).
   */
  defaultPermissionMode: PermissionMode.optional(),
  /** Why the default reads as it does, when there is something to say (see {@link DEFAULT_MODE_NOTICES}). */
  defaultPermissionModeNotice: DefaultModeNotice.optional(),
  /**
   * The project's own default model per agent (story 11); an agent missing
   * from it uses the install's default. Absent: none (and from older servers).
   */
  defaultModels: z.record(AgentId, ModelId).optional(),
  /** The project's own choice of what a message sent while the agent works does (send now or wait); absent: the app-wide one. */
  whileWorking: WhileWorking.optional(),
  /** Whether the Orchestration piece is on for this project (epic 15). Absent: off (and from older servers). */
  orchestrationEnabled: z.boolean().optional(),
  /** The project's orchestration mode (epic 15). Absent: Approve each instruction (and from older servers). */
  orchestrationMode: OrchestrationMode.optional(),
  /** Present once the user confirmed Dispatch automatically for this project (15.8): it is asked once, and the record is in the event log. */
  orchestrationAutomaticConfirmed: z.literal(true).optional(),
  /** The project's team roster (epic 15). Absent: nobody assigned yet. */
  orchestrationRoster: TeamRoster.optional(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

/** `GET` and `PATCH /api/v1/workspaces/:wsId/settings`. */
export const WorkspaceSettingsResponse = z.object({ settings: WorkspaceSettings });
export type WorkspaceSettingsResponse = z.infer<typeof WorkspaceSettingsResponse>;

/**
 * `PATCH /api/v1/workspaces/:wsId/settings`: the fields to change. The pieces
 * must satisfy the dependency rule (story 10.2); turning on a piece this
 * install doesn't ship is refused by core with `feature_unavailable`.
 * `defaultAgentId` (epic 6, entry 6) is the agent new chats preselect;
 * `null` goes back to the install's default, and an agent this install
 * doesn't have is refused with `agent_unknown`.
 */
export const UpdateWorkspaceSettingsRequest = z
  .object({
    cautionLevel: CautionLevel.optional(),
    bmadPieces: BmadPieceSet.optional(),
    defaultAgentId: AgentId.nullable().optional(),
    /**
     * The mode new chats start in (default permission mode). Skip all is
     * refused without Developer mode (`developer_mode_required`) or without
     * `confirm: true`, the user's answer to its red warning (`confirmation_required`).
     */
    defaultPermissionMode: PermissionMode.optional(),
    confirm: z.boolean().optional(),
    /** Per agent: its default model in this project, or `null` to use the install's (story 11). Agents left out keep theirs. */
    defaultModels: z.record(AgentId, ModelId.nullable()).optional(),
    /** `null` goes back to the app-wide choice (send now or wait). */
    whileWorking: WhileWorking.nullable().optional(),
    /**
     * Orchestration (epic 15): the piece's switch (refused with `feature_unavailable` where the install does not ship it), the mode, and the team roster. Switching to
     * automatic needs `confirm: true` (`confirmation_required`); the roster is
     * checked against the install's agents (`agent_unknown`).
     */
    orchestrationEnabled: z.boolean().optional(),
    orchestrationMode: OrchestrationMode.optional(),
    orchestrationRoster: TeamRoster.optional(),
  })
  .refine(
    (settings) =>
      settings.cautionLevel !== undefined ||
      settings.bmadPieces !== undefined ||
      settings.defaultAgentId !== undefined ||
      settings.defaultPermissionMode !== undefined ||
      settings.defaultModels !== undefined ||
      settings.whileWorking !== undefined ||
      settings.orchestrationEnabled !== undefined ||
      settings.orchestrationMode !== undefined ||
      settings.orchestrationRoster !== undefined,
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

/** `PUT /api/v1/workspaces/:wsId/sessions/:sesId/model` (story 11): the agent's own model id, or `null` for its own choice. */
export const SetSessionModelRequest = z.object({ model: ModelId.nullable() });
export type SetSessionModelRequest = z.infer<typeof SetSessionModelRequest>;

/** `PUT /api/v1/chat-agents/:agentId/default-model` (story 11): the install-wide default, or `null` for the agent's own choice. */
export const SetAgentDefaultModelRequest = z.object({ model: ModelId.nullable() });
export type SetAgentDefaultModelRequest = z.infer<typeof SetAgentDefaultModelRequest>;

/**
 * `GET` and `PUT /api/v1/settings/developer-mode`. `everSet` says whether
 * Developer mode was ever turned on or off on this install (a browser carries
 * its old browser-only "on" over only when it never was).
 */
export const DeveloperModeResponse = z.object({ developerMode: z.boolean(), everSet: z.boolean().optional() });
export type DeveloperModeResponse = z.infer<typeof DeveloperModeResponse>;

/** `PUT /api/v1/settings/developer-mode`. */
export const SetDeveloperModeRequest = z.object({
  developerMode: z.boolean(),
  /**
   * What to do with terminal panes whose programs are running when Developer mode is turned off (epic 16, story
   * 16.9): `stop` ends them, `keep` leaves them running in the background until the server stops (they come
   * back when Developer mode is turned on again). Without it, turning it off with panes running is refused (409 `panes_running`).
   */
  panes: z.enum(['stop', 'keep']).optional(),
});
export type SetDeveloperModeRequest = z.infer<typeof SetDeveloperModeRequest>;

// ---------------------------------------------------------------------------
// Send now or wait (2026-10-04).
// ---------------------------------------------------------------------------

/** `GET` and `PUT /api/v1/settings/chat`: the app-wide choice of what a message sent while the agent works does. */
export const ChatSettingsResponse = z.object({ whileWorking: WhileWorking });
export type ChatSettingsResponse = z.infer<typeof ChatSettingsResponse>;

/** `PUT /api/v1/settings/chat`. */
export const SetChatSettingsRequest = z.object({ whileWorking: WhileWorking });
export type SetChatSettingsRequest = z.infer<typeof SetChatSettingsRequest>;

/**
 * `PATCH /api/v1/workspaces/:wsId/sessions/:sesId/queue/:messageId`: change
 * one waiting message: its text, or its place (`position`, 0 = goes next).
 */
export const UpdateQueuedMessageRequest = z
  .object({ content: MessageText.optional(), position: z.number().int().min(0).optional() })
  .refine((input) => input.content !== undefined || input.position !== undefined, 'Choose what to change.');
export type UpdateQueuedMessageRequest = z.infer<typeof UpdateQueuedMessageRequest>;


/** ACP session servers: stdio, HTTP and SSE; ACP channel servers need a host implementation. */
const McpName = z.string().trim().min(1).max(128);
const McpPair = z.object({ name: z.string().min(1).max(256), value: z.string().max(16384) }).strict();
const McpUrl = z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an HTTP or HTTPS URL.');
export const GlobalMcpServer = z.union([
  z.object({ name: McpName, command: z.string().trim().min(1).max(4096), args: z.array(z.string().max(16384)).max(128).default([]), env: z.array(McpPair.extend({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use a valid environment variable name.') })).max(128).default([]) }).strict(),
  z.object({ name: McpName, type: z.enum(['http', 'sse']), url: McpUrl, headers: z.array(McpPair.extend({ name: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, 'Use a valid HTTP header name.'), value: z.string().max(16384).refine((value) => !/[\r\n]/.test(value), 'Header values cannot contain line breaks.') })).max(128).default([]) }).strict(),
 ]).superRefine((server, context) => {
  if ('command' in server) return;
  server.headers.forEach((header, index) => {
    if (/^(?:proxy-)?authorization$/i.test(header.name) && header.value.trim() !== '' && !/^(Bearer|Basic)\s+(.+)$/i.test(header.value.trim())) {
      context.addIssue({ code: 'custom', path: ['headers', index, 'value'], message: 'MCP authorization headers must use Bearer or Basic credentials.' });
    }
  });
});
export type GlobalMcpServer = z.infer<typeof GlobalMcpServer>;
export const GlobalMcpServers = z.array(GlobalMcpServer).max(64).refine((servers) => new Set(servers.map((server) => server.name)).size === servers.length, 'MCP server names must be unique.');
export const GlobalMcpServersResponse = z.object({ servers: GlobalMcpServers });
export type GlobalMcpServersResponse = z.infer<typeof GlobalMcpServersResponse>;
export const SetGlobalMcpServersRequest = GlobalMcpServersResponse;
export type SetGlobalMcpServersRequest = z.infer<typeof SetGlobalMcpServersRequest>;
