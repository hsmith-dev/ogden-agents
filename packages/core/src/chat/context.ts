/**
 * The state the chat modules share (story 3.11), built once per
 * {@link createChat}: the options-derived values, the collections (one
 * instance each, never copied or spread: the modules' identity checks rely on
 * it) and `closing`, read as `ctx.closing` at each use, never copied.
 */
import type { AgentId, AgentModel, PermissionMode, Session, SessionId, Workspace, WorkspaceId } from '@ogden-agents/shared';
import { monotonicFactory } from 'ulid';
import { AgentError, unregisteredAgent, type AgentPort, type AgentRegistry, type AgentSessionModels, type ProtectedPaths } from '../agent-port.js';
import { agentConfigFolders } from '../agent-descriptor.js';
import { canonicalWorkspacePath, type Entities } from '../entities.js';
import { NotFoundError } from '../errors.js';
import { protectedPathsWith } from '../permission-matching.js';
import { createDecliningPermissions, type Permissions } from '../permissions.js';
import type { SessionEvents } from '../session-events.js';
import { clampCheckInDelay, DEFAULT_CHECK_IN_MS, PERMISSION_MODE_TIMEOUT_MS, STOP_GRACE_MS } from './constants.js';
import type { ChatOptions, Live, Terminal, Timer, Turn } from './types.js';

// One monotonic factory for the process, as before the split: message ids and `preq_` ids share it.
const nextUlid = monotonicFactory();

/** Message ids are unique within the install; they are not entity keys. */
const newMessageId = () => `msg_${nextUlid()}`;

/** Starts a timer that never keeps the process alive. */
const later = (ms: number, run: () => void): Timer => {
  const timer = setTimeout(run, ms);
  (timer as { unref?: () => void }).unref?.();
  return timer;
};

export interface ChatContext {
  readonly options: ChatOptions;
  readonly entities: Entities;
  readonly sessionEvents: SessionEvents;
  readonly agents: AgentRegistry;
  /** The session's agent id: its own, or the registry's legacy agent for a session stored before agents could be chosen. */
  readonly agentIdOf: (session: Pick<Session, 'agentId'>) => AgentId;
  /** The session's agent; one not registered this run is a stand-in that can't start (`agent_unavailable`). */
  readonly agentOf: (sessionId: SessionId) => AgentPort;
  /** The session as the chat answers it: with its `agentId` filled in (epic 6). */
  readonly withAgentId: (session: Session) => Session;
  readonly permissions: Permissions;
  /** The environment the session's agent processes get (its own API key only). */
  readonly agentEnv: (sessionId: SessionId) => Readonly<Record<string, string>>;
  readonly checkInDelayMs: number;
  readonly stopGraceMs: number;
  readonly live: Map<SessionId, Live>;
  /** Sessions whose agent is answering, with what is left to send; another message is queued until it ends. */
  readonly busy: Map<SessionId, Turn>;
  readonly running: Set<Promise<void>>;
  /**
   * Dropped agents still stopping, by session: `close` waits for them, and so
   * does the session's next agent, so no agent process (or its tree) outlives
   * the chat or runs beside its replacement (AD-3).
   */
  readonly droppedAgents: Map<SessionId, Promise<void>>;
  /** The terminals driving sessions (story 3.1). */
  readonly terminals: Map<SessionId, Terminal>;
  /** Sessions between drivers: no message is taken and no other switch starts. */
  readonly switching: Set<SessionId>;
  /** The permission modes each session's agent session offered when it last started this run (permission modes). */
  readonly sessionModes: Map<SessionId, readonly PermissionMode[]>;
  /** The permission modes the agent session started last in this run offered, per agent (any chat of it): a chat whose own agent hasn't started yet. */
  readonly lastSessionModes: Map<AgentId, readonly PermissionMode[]>;
  /** The models each session's agent session listed, and runs on, as it last said this run (story 11). */
  readonly sessionModels: Map<SessionId, AgentSessionModels>;
  /** The models the agent last listed: this install's record, else this run's, else its descriptor's static list (story 11). */
  readonly agentModelList: (agentId: AgentId) => readonly AgentModel[] | undefined;
  /** Keeps the agent's model list (this run, and the install's record). */
  readonly rememberModels: (agentId: AgentId, models: readonly AgentModel[]) => void;
  /** How long an agent may take to take a permission mode. */
  readonly permissionModeTimeoutMs: number;
  /** Whether Developer mode is on now. */
  readonly developerMode: () => boolean;
  /** Set by `close`: no event from a stopping agent changes a session any more. Read as `ctx.closing`, never copied. */
  closing: boolean;
  readonly dataHome: string;
  readonly internalError: (sessionId: SessionId, error: unknown) => void;
  readonly toAgentError: (sessionId: SessionId, error: unknown) => AgentError;
  readonly later: (ms: number, run: () => void) => Timer;
  readonly nextUlid: () => string;
  readonly newMessageId: () => string;
  readonly getWorkspace: (workspaceId: WorkspaceId) => Workspace;
  /** Whether the project is trusted now (story 4.2's gate, with its contents since 4.13 and the agent files since 12.3); no port, a no, or a throw is untrusted. */
  readonly projectTrusted: (workspaceId: WorkspaceId) => Promise<boolean>;
  /** The protected paths agents are told to keep guarded in Auto: core's, plus the registered agents' own config folders (epic 12, 12.3). */
  readonly protectedPaths: () => ProtectedPaths;
  readonly getSession: (workspaceId: WorkspaceId, sessionId: SessionId) => Session;
}

export function createChatContext(options: ChatOptions): ChatContext {
  const { entities, sessionEvents, agents } = options;
  const permissions = options.permissions ?? createDecliningPermissions();
  const agentIdOf = (session: Pick<Session, 'agentId'>): AgentId => session.agentId ?? agents.legacyAgentId;
  const missing = unregisteredAgent();
  const agentOf = (sessionId: SessionId): AgentPort => {
    const session = entities.getSession(sessionId);
    return (session === undefined ? undefined : agents.get(agentIdOf(session))) ?? missing;
  };
  const withAgentId = (session: Session): Session => (session.agentId === undefined ? { ...session, agentId: agents.legacyAgentId } : session);
  const agentEnv = (sessionId: SessionId): Readonly<Record<string, string>> => {
    const session = entities.getSession(sessionId);
    return session === undefined ? {} : (options.agentEnv?.(agentIdOf(session)) ?? {});
  };
  const checkInDelayMs = clampCheckInDelay(options.checkInDelayMs ?? DEFAULT_CHECK_IN_MS);
  const stopGraceMs = options.stopGraceMs ?? STOP_GRACE_MS;
  const live = new Map<SessionId, Live>();
  const busy = new Map<SessionId, Turn>();
  const running = new Set<Promise<void>>();
  const droppedAgents = new Map<SessionId, Promise<void>>();
  const terminals = new Map<SessionId, Terminal>();
  const switching = new Set<SessionId>();
  const sessionModes = new Map<SessionId, readonly PermissionMode[]>();
  const permissionModeTimeoutMs = options.permissionModeTimeoutMs ?? PERMISSION_MODE_TIMEOUT_MS;
  const sessionModels = new Map<SessionId, AgentSessionModels>();
  /** This run's lists, per agent, when no install record is kept. */
  const runModels = new Map<AgentId, readonly AgentModel[]>();
  const agentModelList = (agentId: AgentId): readonly AgentModel[] | undefined =>
    options.agentModels?.lastModels(agentId) ?? runModels.get(agentId) ?? agents.describe(agentId)?.models?.list;
  const rememberModels = (agentId: AgentId, models: readonly AgentModel[]) => {
    if (models.length === 0) return;
    runModels.set(agentId, models);
    options.agentModels?.rememberModels(agentId, models);
  };
  const developerMode = () => options.installSettings?.developerMode() === true;
  const dataHome = canonicalWorkspacePath(options.dataDir);

  const internalError = (sessionId: SessionId, error: unknown) => {
    try {
      options.onInternalError?.(sessionId, error);
    } catch {
      // Logging must never break a turn.
    }
  };

  const toAgentError = (sessionId: SessionId, error: unknown): AgentError =>
    error instanceof AgentError
      ? error
      : new AgentError('agent_failed', `${agentOf(sessionId).displayName} stopped with an error. Try again.`, {
          details: { reason: error instanceof Error ? error.message : String(error) },
          cause: error,
        });

  const getWorkspace = (workspaceId: WorkspaceId): Workspace => {
    const workspace = entities.getWorkspace(workspaceId);
    if (workspace === undefined) throw new NotFoundError('workspace', workspaceId);
    return workspace;
  };

  const getSession = (workspaceId: WorkspaceId, sessionId: SessionId): Session => {
    const session = entities.getSession(sessionId);
    // Another workspace's session is as absent as a missing one: nothing leaks across (AD-2).
    if (session === undefined || session.workspaceId !== workspaceId) throw new NotFoundError('session', sessionId);
    return session;
  };

  const protectedPaths = (): ProtectedPaths =>
    protectedPathsWith(agentConfigFolders(agents.agentIds.flatMap((agentId) => agents.describe(agentId) ?? [])));
  const projectTrusted = async (workspaceId: WorkspaceId): Promise<boolean> => {
    try {
      return (await options.projectTrusted?.(workspaceId)) === true;
    } catch {
      return false;
    }
  };

  return {
    options,
    entities,
    sessionEvents,
    agents,
    agentIdOf,
    agentOf,
    withAgentId,
    permissions,
    agentEnv,
    checkInDelayMs,
    stopGraceMs,
    live,
    busy,
    running,
    droppedAgents,
    terminals,
    switching,
    sessionModes,
    lastSessionModes: new Map(),
    sessionModels,
    agentModelList,
    rememberModels,
    permissionModeTimeoutMs,
    developerMode,
    closing: false,
    dataHome,
    internalError,
    toAgentError,
    later,
    nextUlid,
    newMessageId,
    getWorkspace,
    projectTrusted,
    protectedPaths,
    getSession,
  };
}
