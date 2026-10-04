/** Workspaces and their sessions, and deleting a workspace's history (moved from `chat.ts`, story 3.11). */
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { PERMISSION_MODES, type AgentId, type ChatAgent, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import { apiKeyMethod, type AgentDescriptor } from '../agent-descriptor.js';
import type { AgentPort } from '../agent-port.js';
import type { AgentReadiness } from '../agent-setup-types.js';
import { canonicalWorkspacePath } from '../entities.js';
import { AgentNotReadyError, CoreError, InvalidOperationError, UnknownAgentError, WorkspaceBusyError } from '../errors.js';
import type { Agents } from './agents.js';
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

/** The plain reason a chat with an agent that needs a trusted project is refused in one that isn't. */
export const projectNotTrustedReason = (name: string) => `${name} uses this project's own agent settings, so trust the project before starting a ${name} chat.`;

/** One agent as the agent list shows it (6.3): agent-neutral data from its descriptor, its port and its readiness. */
export function chatAgentOf(descriptor: AgentDescriptor, agent: AgentPort, readiness: AgentReadiness): ChatAgent {
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
  };
}

export function createWorkspaces(ctx: ChatContext, deps: Pick<Agents, 'drop'> & { stopTerminal: (sessionId: SessionId) => Promise<void> }) {
  const { entities, agents, live, busy, dataHome, getWorkspace, getSession } = ctx;
  const { drop, stopTerminal } = deps;

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
      // Picked by data, never by a branch on an id (E6-R2); fixed for the session's life (E6-R1).
      const agentId = options.agentId ?? agents.defaultAgentId;
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
      return entities.createSession({ workspaceId, kind: options.kind ?? 'chat', agentId });
    },

    async chatAgents() {
      const listed = await Promise.all(
        agents.agentIds.map(async (agentId) => {
          const agent = agents.get(agentId);
          const descriptor = agents.describe(agentId);
          return agent === undefined || descriptor === undefined ? [] : [chatAgentOf(descriptor, agent, await readiness(agentId))];
        }),
      );
      return { agents: listed.flat(), defaultAgentId: agents.defaultAgentId };
    },

    getSession,
  };

  return methods;
}
