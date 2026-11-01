/** Workspaces and their sessions (moved from `chat.ts`, story 3.11); deleting a chat or a workspace's history is `delete-chat.ts`'s (27.3). */
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import {
  CHAT_WORKTREE_FAILED_TEXT,
  CHAT_WORKTREE_KIND_TEXT,
  CHAT_WORKTREE_NOT_REPO_TEXT,
  CHAT_WORKTREE_NOT_TOP_TEXT,
  CHAT_WORKTREE_REMOTE_TEXT,
  chatWorktreeBranch,
  DEFAULT_MODE_NOTICE_TEXT,
  ModelId as ModelIdSchema,
  PERMISSION_MODE_LABELS,
  PERMISSION_MODES,
  projectNotTrustedReason,
  type AgentId,
  type AgentModel,
  type ChatAgent,
  type PermissionMode,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { apiKeyMethod, type AgentDescriptor } from '../agent-descriptor.js';
import { effectiveDefaultAgent, type AgentPort } from '../agent-port.js';
import type { AgentReadiness } from '../agent-setup-types.js';
import { runShortId } from '../build-names.js';
import { ensureChatWorktreesRoot, isChatWorktreePath } from '../chat-worktrees.js';
import { canonicalWorkspacePath } from '../entities.js';
import { AgentNotReadyError, CoreError, InvalidOperationError, LocalOnlyAgentError, UnknownAgentError, ValidationError } from '../errors.js';
import { newId } from '../ids.js';
import { serializedByRepo } from '../repo-serialization.js';
import { workspaceFolder } from '../workspace-root.js';
import type { Models } from './model.js';
import type { ChatContext } from './context.js';
import type { Chat } from './types.js';

/** A readiness that never refuses: no port, or one that failed ("can't tell" never refuses a chat). */
const READY: AgentReadiness = { install: 'installed', auth: 'signed_in' };

/** Why a new chat with the agent is refused, in plain words naming it, and what fixes it; `undefined` when it isn't. */
export function unavailableReason(descriptor: AgentDescriptor, readiness: AgentReadiness): ChatAgent['unavailable'] {
  const name = descriptor.displayName;
  if (readiness.blocked === 'agent_not_installed') {
    const reason =
      readiness.install === 'installing' ? `${name} is still installing. Start the chat once it's done.` : `${name} isn't installed. Install it in Settings → Agents.`;
    return { code: 'agent_not_installed', reason, action: 'install' };
  }
  if (readiness.blocked === 'agent_signed_out') {
    // An agent that takes only an API key (Codex, Grok) never says "sign in" (user decision, 2026-10-05).
    if (descriptor.signInMethods.length > 0 && descriptor.signInMethods.every((method) => method.kind === 'api_key')) {
      const label = apiKeyMethod(descriptor)?.apiKey.label;
      return { code: 'agent_signed_out', reason: label === undefined ? `${name} needs an API key. Add one in Settings → Agents.` : `${name} needs your ${label}. Add it in Settings → Agents.`, action: 'sign_in' };
    }
    const reason = apiKeyMethod(descriptor) === undefined ? `${name} isn't signed in. Sign in in Settings → Agents.` : `${name} isn't signed in. Sign in or add an API key in Settings → Agents.`;
    return { code: 'agent_signed_out', reason, action: 'sign_in' };
  }
  return undefined;
}

/** One agent as the agent list shows it (6.3): agent-neutral data from its descriptor, its port and its readiness. */
export function chatAgentOf(
  descriptor: AgentDescriptor,
  agent: AgentPort,
  readiness: AgentReadiness,
  models: { list?: readonly AgentModel[] | undefined; defaultModel?: string | undefined } = {},
): ChatAgent {
  const declared = agent.permissionModes ?? [];
  const key = apiKeyMethod(descriptor)?.apiKey;
  const unavailable = unavailableReason(descriptor, readiness);
  return {
    agentId: descriptor.agentId,
    displayName: agent.displayName,
    provider: descriptor.provider,
    signInMethods: descriptor.signInMethods.map(({ kind, label }) => ({ kind, label })),
    ...(key?.format === undefined ? {} : { apiKeyFormat: key.format }),
    ...(key?.label === undefined ? {} : { apiKeyName: key.label }),
    install: readiness.install,
    auth: readiness.auth,
    terminalResume: agent.terminalResume !== undefined,
    needsProjectTrust: descriptor.needsProjectTrust,
    ...(descriptor.noAccount === true ? { noAccount: true } : {}),
    ...(descriptor.interactiveOnly === undefined ? {} : { interactiveOnly: descriptor.interactiveOnly }),
    // Tied to this computer (21.6, 27.5): the draft disables every machine for it with these words.
    ...(agent.localOnlyReason === undefined ? {} : { localOnly: agent.localOnlyReason }),
    // Ask is every agent's (where every chat starts); the rest only as it declares them.
    permissionModes: PERMISSION_MODES.filter((mode) => mode === 'ask' || declared.includes(mode)),
    ...(unavailable === undefined ? {} : { unavailable }),
    // Story 11: what it last listed (or its static list), and the install's default for its new chats.
    ...(models.list === undefined || models.list.length === 0 ? {} : { models: [...models.list] }),
    ...(models.defaultModel === undefined ? {} : { defaultModel: models.defaultModel }),
  };
}

/** The mode a new chat starts in and the note that says why (default permission mode). */
export interface StartingMode {
  mode: PermissionMode;
  note?: string | undefined;
}

/**
 * The mode a new chat starts in (default permission mode): its project's
 * default when its agent declares that mode, the agent's sessions this run
 * haven't left it out, and, for Skip all, Developer mode is on now; else Ask,
 * with a note naming why. Read by the caller in the same synchronous step
 * that creates the session, so Developer mode turned off in between can't
 * leave a new chat in Skip all.
 */
export function startingMode(input: {
  projectDefault: PermissionMode;
  notice?: string | undefined;
  agentName: string;
  declared: readonly PermissionMode[] | undefined;
  listed: readonly PermissionMode[] | undefined;
  developerMode: boolean;
}): StartingMode {
  const { projectDefault: mode, agentName } = input;
  if (mode === 'ask') {
    // A Skip all from the app-wide default that waits for this project's confirmation says so.
    return input.notice === undefined ? { mode: 'ask' } : { mode: 'ask', note: input.notice };
  }
  const label = PERMISSION_MODE_LABELS[mode];
  const fallback = (why: string): StartingMode => ({ mode: 'ask', note: `${why}, so this chat started in Ask instead of this project's default.` });
  if (!(input.declared ?? []).includes(mode)) return fallback(`${agentName} doesn't offer ${label}`);
  if (input.listed !== undefined && !input.listed.includes(mode)) return fallback(`${agentName} on this computer doesn't offer ${label}`);
  if (mode === 'skip_all' && !input.developerMode) return fallback('Skip all needs Developer mode');
  return { mode, note: `This chat started in ${label}, this project's default.` };
}

/** The agent's readiness, or {@link READY} without a port or when it fails. */
export async function agentReadiness(ctx: ChatContext, agentId: AgentId): Promise<AgentReadiness> {
  try {
    return (await ctx.options.agentReadiness?.(agentId)) ?? READY;
  } catch {
    return READY;
  }
}

/** Whether the project is trusted now (story 4.2's gate); no port, a no, or a throw is untrusted. */
export async function isProjectTrusted(ctx: ChatContext, workspaceId: WorkspaceId): Promise<boolean> {
  try {
    return (await ctx.options.projectTrusted?.(workspaceId)) === true;
  } catch {
    return false;
  }
}

/**
 * Refuses, with `AgentNotReadyError`, an agent that can't take a chat in the
 * workspace now (6.3): one that needs a trust the project lacks, isn't
 * installed, or isn't signed in. A new chat and a handoff both pass here.
 */
export async function requireAgentReady(ctx: ChatContext, workspaceId: WorkspaceId, agentId: AgentId, descriptor: AgentDescriptor): Promise<void> {
  // An agent that runs the project's own agent settings or hooks starts only in a trusted project (6.3).
  if (descriptor.needsProjectTrust && !(await isProjectTrusted(ctx, workspaceId))) {
    throw new AgentNotReadyError('project_not_trusted', projectNotTrustedReason(descriptor.displayName), agentId, 'trust_project');
  }
  const unavailable = unavailableReason(descriptor, await agentReadiness(ctx, agentId));
  if (unavailable !== undefined) throw new AgentNotReadyError(unavailable.code, unavailable.reason, agentId, unavailable.action);
}

/** The real path of `path`, or `undefined` when it can't be resolved. */
function realOrUndefined(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

/** A chat's own worktree as made: its session id, real path and branch. */
interface MadeChatWorktree {
  id: SessionId;
  worktreePath: string;
  branch: string;
}

/**
 * Makes a new chat's worktree (27.1): the project must be its repository's
 * top folder with a checked-out commit; the worktree is `<data>/cw/<8>` on
 * `ogden/chat/<id>` from that commit, made with the repo's other git work
 * serialized. Every refusal is an {@link InvalidOperationError} in a plain
 * sentence; a failure once `addWorktree` started removes its folder, best effort.
 */
async function makeChatWorktree(ctx: ChatContext, workspaceId: WorkspaceId): Promise<MadeChatWorktree> {
  const vcs = ctx.options.vcs;
  if (vcs === undefined) throw new InvalidOperationError(CHAT_WORKTREE_FAILED_TEXT);
  const repoPath = workspaceFolder(ctx.getWorkspace(workspaceId));
  return serializedByRepo(repoPath, async () => {
    // A worktree is of the whole repository: the project must be its top folder.
    const top = await vcs.topLevel(repoPath);
    if (top === undefined) throw new InvalidOperationError(CHAT_WORKTREE_NOT_REPO_TEXT);
    if ((realOrUndefined(top) ?? top) !== (realOrUndefined(repoPath) ?? repoPath)) throw new InvalidOperationError(CHAT_WORKTREE_NOT_TOP_TEXT);
    const head = await vcs.head(repoPath);
    if (head === undefined) throw new InvalidOperationError(CHAT_WORKTREE_NOT_REPO_TEXT);
    let parent: string;
    try {
      parent = ensureChatWorktreesRoot(ctx.options.dataDir);
    } catch {
      throw new InvalidOperationError(CHAT_WORKTREE_FAILED_TEXT);
    }
    // A folder name no chat has yet (40 random bits, tried a few times).
    let short = runShortId();
    for (let attempt = 0; existsSync(join(parent, short)); attempt++) {
      if (attempt >= 5) throw new InvalidOperationError(CHAT_WORKTREE_FAILED_TEXT);
      short = runShortId();
    }
    const id = newId('ses') as SessionId;
    const branch = chatWorktreeBranch(id);
    const path = join(parent, short);
    try {
      await vcs.addWorktree(repoPath, { path, branch, base: head.revision });
    } catch {
      // Already in the repo's chain: cleaned up here, not through `discardChatWorktree`.
      await removeUnusedWorktree(ctx, repoPath, { id, worktreePath: path, branch });
      throw new InvalidOperationError(CHAT_WORKTREE_FAILED_TEXT);
    }
    return { id, worktreePath: realOrUndefined(path) ?? path, branch };
  });
}

/** Removes a chat worktree's folder that no chat got, best effort (never through a link: `rmSync` doesn't follow one). */
function removeFolder(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort: an empty folder in `<data>/cw` names no chat.
  }
}

/**
 * A worktree no chat got (27.3): git's record of it and its branch through
 * `VcsPort` (the branch has no commit yet), then whatever of the folder is
 * left, best effort. Only a path `isChatWorktreePath` accepts; the caller
 * holds the repo's chain.
 */
async function removeUnusedWorktree(ctx: ChatContext, repoPath: string, worktree: MadeChatWorktree): Promise<void> {
  if (!isChatWorktreePath(ctx.options.dataDir, worktree.worktreePath)) return;
  try {
    await ctx.options.vcs?.removeWorktree(repoPath, worktree.worktreePath, { deleteBranch: worktree.branch });
  } catch (error) {
    try {
      ctx.options.onWorktreeCleanupError?.(worktree.id, 'remove', error);
    } catch {
      // The log never changes the refusal.
    }
  }
  removeFolder(worktree.worktreePath);
}

/** {@link removeUnusedWorktree} with the repo's other git work serialized: a creation that failed after its worktree was made. */
const discardChatWorktree = (ctx: ChatContext, repoPath: string, worktree: MadeChatWorktree): Promise<void> =>
  serializedByRepo(repoPath, () => removeUnusedWorktree(ctx, repoPath, worktree));

export function createWorkspaces(ctx: ChatContext, deps: Pick<Models, 'initialModel'>) {
  const { entities, agents, dataHome, getWorkspace, getSession } = ctx;
  const { initialModel } = deps;
  const readiness = (agentId: AgentId) => agentReadiness(ctx, agentId);
  const { projectTrusted } = ctx;

  const methods: Pick<Chat, 'openWorkspace' | 'listWorkspaces' | 'getWorkspace' | 'listSessions' | 'createChatSession' | 'getSession' | 'chatAgents'> = {
    openWorkspace(input, options) {
      const path = input === '~' ? homedir() : input.startsWith('~/') || input.startsWith('~\\') ? join(homedir(), input.slice(2)) : input;
      if (!isAbsolute(path)) throw new InvalidOperationError('Enter the full path of the folder, starting from the top of the disk.');
      try {
        const candidate = canonicalWorkspacePath(path);
        const within = (inner: string, outer: string) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
        if (within(candidate, dataHome) || within(dataHome, candidate)) {
          throw new InvalidOperationError("That folder holds Ogden Agents' own data, so it can't be a project.");
        }
        return entities.ensureWorkspace(path, options);
      } catch (error) {
        if (error instanceof CoreError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') throw new InvalidOperationError('There is no folder at that path on this computer.');
        if (code === 'EACCES' || code === 'EPERM') throw new InvalidOperationError("Ogden Agents can't open that folder: permission denied.");
        throw error;
      }
    },

    listWorkspaces: () => entities.listWorkspaces(),

    getWorkspace,

    listSessions(workspaceId) {
      getWorkspace(workspaceId);
      return entities.listSessions(workspaceId);
    },

    async createChatSession(workspaceId, options = {}) {
      getWorkspace(workspaceId);
      // A model given (an agent handoff's target, story 11) must be a model id; whether the agent offers it is the agent's to say.
      if (options.model !== undefined && options.model !== null && !ModelIdSchema.safeParse(options.model).success) {
        throw new ValidationError("Choose a model the agent offers, or the agent's default.", [{ path: ['model'], message: 'not a model id' }]);
      }
      // Picked by data, never by a branch on an id (E6-R2); fixed for the session's life (E6-R1).
      // None picked: the project's default (entry 6), when it is still registered, else the install's.
      const projectDefault = options.agentId === undefined ? ctx.permissions.getSettings(workspaceId).defaultAgentId : undefined;
      const agentId = options.agentId ?? effectiveDefaultAgent(agents, projectDefault);
      const descriptor = agents.describe(agentId);
      const port = agents.get(agentId);
      if (port === undefined || descriptor === undefined) throw new UnknownAgentError();
      // An agent tied to this computer never gets a remote chat (27.5): refused before anything is made or connected.
      if (options.machineId !== undefined && options.machineId !== null && port.localOnlyReason !== undefined) throw new LocalOnlyAgentError(port.localOnlyReason);
      await requireAgentReady(ctx, workspaceId, agentId, descriptor);
      // The workspace may have been removed while the readiness was read.
      getWorkspace(workspaceId);
      // Its own worktree (27.1): only a plain local chat; made before the step below, which never awaits.
      let worktree: MadeChatWorktree | undefined;
      let worktreeRepo: string | undefined;
      if (options.location === 'worktree') {
        if ((options.kind ?? 'chat') !== 'chat') throw new InvalidOperationError(CHAT_WORKTREE_KIND_TEXT);
        if (options.machineId !== undefined && options.machineId !== null) {
          throw new ValidationError(CHAT_WORKTREE_REMOTE_TEXT, [{ path: ['location'], message: CHAT_WORKTREE_REMOTE_TEXT }]);
        }
        const repoPath = workspaceFolder(getWorkspace(workspaceId));
        worktree = await makeChatWorktree(ctx, workspaceId);
        try {
          getWorkspace(workspaceId);
        } catch (error) {
          await discardChatWorktree(ctx, repoPath, worktree);
          throw error;
        }
        worktreeRepo = repoPath;
      }
      // Its model (story 11): the one given, else the project's default for the agent, else the install's, else its own choice.
      const model = options.model !== undefined ? options.model : initialModel(workspaceId, agentId);
      // From here to the insert nothing awaits: the default, Developer mode and the agent's modes are read
      // in the same step that creates the session (default permission mode).
      const settings = ctx.permissions.getSettings(workspaceId);
      const start = startingMode({
        projectDefault: settings.defaultPermissionMode ?? 'ask',
        notice: settings.defaultPermissionModeNotice === 'skip_all_unconfirmed' ? DEFAULT_MODE_NOTICE_TEXT.skip_all_unconfirmed : undefined,
        agentName: descriptor.displayName,
        declared: agents.get(agentId)?.permissionModes,
        listed: ctx.lastSessionModes.get(agentId),
        developerMode: ctx.developerMode(),
      });
      const create = () => entities.createSession({
        workspaceId,
        kind: options.kind ?? 'chat',
        agentId,
        model,
        // A build session is always Ask (epic 17): the project's default mode (Auto, Skip all) never reaches a build's agent, and a build session's mode never changes.
        permissionMode: options.kind === 'build' ? 'ask' : start.mode,
        ...(start.note === undefined || options.kind === 'build' ? {} : { permissionModeNote: start.note }),
        ...(options.autoTitle === undefined ? {} : { autoTitle: options.autoTitle }),
        // The chat's remote target (CAP-24, epic 19 story 19.7), fixed for its life: only its shape is checked
        // here (`entities.createSession`'s own schema check); whether it is reachable is `agentFor`'s own
        // connect-time refusal, never duplicated here.
        machineId: options.machineId ?? null,
        // A worktree chat's id is its branch's (27.1); its path and branch are set here at creation; changed only by Hand off or a Restore onto a new branch (`setSessionWorktree`, recorded as `session.location_changed`).
        ...(worktree === undefined ? {} : { id: worktree.id, worktreePath: worktree.worktreePath, branch: worktree.branch }),
      });
      if (worktree === undefined || worktreeRepo === undefined) return create();
      let created;
      try {
        created = create();
      } catch (error) {
        // Its folder, git's record of it and its branch go (27.3); the original error is the answer.
        await discardChatWorktree(ctx, worktreeRepo, worktree);
        throw error;
      }
      // One more chat worktree: the retention sweep runs, sparing this one (27.6).
      try {
        ctx.options.onChatWorktreeAdded?.(created.id);
      } catch {
        // The sweep never fails a creation.
      }
      return created;
    },

    async chatAgents(workspaceId) {
      // Whether the project is trusted is asked once, and only for an agent that needs it.
      const trusted = workspaceId === undefined || !agents.agentIds.some((agentId) => agents.describe(agentId)?.needsProjectTrust === true) ? undefined : await projectTrusted(workspaceId);
      const listed = await Promise.all(
        agents.agentIds.map(async (agentId) => {
          const agent = agents.get(agentId);
          const descriptor = agents.describe(agentId);
          if (agent === undefined || descriptor === undefined) return [];
          let defaultModel: string | undefined;
          try {
            defaultModel = ctx.options.agentModels?.defaultModel(agentId);
          } catch {
            defaultModel = undefined;
          }
          const listedAgent = chatAgentOf(descriptor, agent, await readiness(agentId), { list: ctx.agentModelList(agentId), defaultModel });
          // Install and sign-in come first: trusting a project can't fix those.
          if (descriptor.needsProjectTrust && trusted === false && listedAgent.unavailable === undefined) {
            return [{ ...listedAgent, unavailable: { code: 'project_not_trusted' as const, reason: projectNotTrustedReason(descriptor.displayName), action: 'trust_project' as const } }];
          }
          return [listedAgent];
        }),
      );
      return { agents: listed.flat(), defaultAgentId: agents.defaultAgentId };
    },

    getSession,
  };

  return methods;
}
