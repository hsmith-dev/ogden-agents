/** Workspaces and their sessions, and deleting a workspace's history (moved from `chat.ts`, story 3.11). */
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { PERMISSION_MODES, type SessionId } from '@ogden-agents/shared';
import { canonicalWorkspacePath } from '../entities.js';
import { CoreError, InvalidOperationError, UnknownAgentError, WorkspaceBusyError } from '../errors.js';
import type { Agents } from './agents.js';
import type { ChatContext } from './context.js';
import type { Chat } from './types.js';

export function createWorkspaces(ctx: ChatContext, deps: Pick<Agents, 'drop'> & { stopTerminal: (sessionId: SessionId) => Promise<void> }) {
  const { entities, agents, live, busy, dataHome, getWorkspace, getSession } = ctx;
  const { drop, stopTerminal } = deps;

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

    createChatSession(workspaceId, options = {}) {
      getWorkspace(workspaceId);
      // Picked by data, never by a branch on an id (E6-R2); fixed for the session's life (E6-R1).
      const agentId = options.agentId ?? agents.defaultAgentId;
      if (agents.get(agentId) === undefined) throw new UnknownAgentError();
      return entities.createSession({ workspaceId, kind: options.kind ?? 'chat', agentId });
    },

    chatAgents() {
      const listed = agents.agentIds.flatMap((agentId) => {
        const agent = agents.get(agentId);
        if (agent === undefined) return [];
        // Ask is every agent's (where every chat starts); the rest only as it declares them.
        const declared = agent.permissionModes ?? [];
        return [{ agentId, displayName: agent.displayName, permissionModes: PERMISSION_MODES.filter((mode) => mode === 'ask' || declared.includes(mode)) }];
      });
      return { agents: listed, defaultAgentId: agents.defaultAgentId };
    },

    getSession,
  };

  return methods;
}
