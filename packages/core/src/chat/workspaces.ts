/** Workspaces and their sessions, and deleting a workspace's history (moved from `chat.ts`, story 3.11). */
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import {
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
import { canonicalWorkspacePath } from '../entities.js';
import { AgentNotReadyError, CoreError, InvalidOperationError, UnknownAgentError, ValidationError, WorkspaceBusyError } from '../errors.js';
import type { Agents } from './agents.js';
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
    install: readiness.install,
    auth: readiness.auth,
    terminalResume: agent.terminalResume !== undefined,
    needsProjectTrust: descriptor.needsProjectTrust,
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

export function createWorkspaces(ctx: ChatContext, deps: Pick<Agents, 'drop'> & Pick<Models, 'initialModel'> & { stopTerminal: (sessionId: SessionId) => Promise<void> }) {
  const { entities, agents, live, busy, dataHome, getWorkspace, getSession } = ctx;
  const { drop, stopTerminal, initialModel } = deps;

  /** The agent's readiness, or {@link READY} without a port or when it fails. */
  const readiness = async (agentId: AgentId): Promise<AgentReadiness> => {
    try {
      return (await ctx.options.agentReadiness?.(agentId)) ?? READY;
    } catch {
      return READY;
    }
  };

  /** Whether the project is trusted now (story 4.2's gate); no port, a no, or a throw is untrusted. */
  const projectTrusted = async (workspaceId: WorkspaceId): Promise<boolean> => {
    try {
      return (await ctx.options.projectTrusted?.(workspaceId)) === true;
    } catch {
      return false;
    }
  };

  const methods: Pick<Chat, 'openWorkspace' | 'listWorkspaces' | 'getWorkspace' | 'listSessions' | 'deleteHistory' | 'createChatSession' | 'getSession' | 'chatAgents'> = {
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

    deleteHistory(workspaceId) {
      const sessionIds = entities.listSessions(workspaceId).map((session) => session.id);
      // A turn can be starting before its state reads `working`: the busy set covers that gap.
      if (sessionIds.some((id) => busy.has(id))) throw new WorkspaceBusyError(workspaceId);
      const { deletedEvents, deletedSessions, deletedRuns } = entities.deleteWorkspaceHistory(workspaceId);
      for (const sessionId of sessionIds) {
        const entry = live.get(sessionId);
        if (entry !== undefined) drop(sessionId, entry);
        void stopTerminal(sessionId);
      }
      return { deletedEvents, deletedSessions, deletedRuns };
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
      if (agents.get(agentId) === undefined || descriptor === undefined) throw new UnknownAgentError();
      // An agent that runs the project's own agent settings or hooks starts only in a trusted project (6.3).
      if (descriptor.needsProjectTrust && !(await projectTrusted(workspaceId))) {
        throw new AgentNotReadyError('project_not_trusted', projectNotTrustedReason(descriptor.displayName), agentId, 'trust_project');
      }
      const unavailable = unavailableReason(descriptor, await readiness(agentId));
      if (unavailable !== undefined) throw new AgentNotReadyError(unavailable.code, unavailable.reason, agentId, unavailable.action);
      // The workspace may have been removed while the readiness was read.
      getWorkspace(workspaceId);
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
      return entities.createSession({
        workspaceId,
        kind: options.kind ?? 'chat',
        agentId,
        model,
        permissionMode: start.mode,
        ...(start.note === undefined ? {} : { permissionModeNote: start.note }),
        ...(options.autoTitle === undefined ? {} : { autoTitle: options.autoTitle }),
      });
    },

    async chatAgents() {
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
          return [chatAgentOf(descriptor, agent, await readiness(agentId), { list: ctx.agentModelList(agentId), defaultModel })];
        }),
      );
      return { agents: listed.flat(), defaultAgentId: agents.defaultAgentId };
    },

    getSession,
  };

  return methods;
}
