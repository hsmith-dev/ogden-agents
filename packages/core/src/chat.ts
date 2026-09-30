/**
 * The chat use-case (story 2.2, the tracer bullet): open a workspace for a
 * repo, create a chat session in it, and send the session's agent a message.
 *
 * Core stores the user's message, marks the session `working` as it hands the
 * message over, and from then on follows the adapter's signals (AD-4): each
 * reply chunk becomes a `session.message_delta`, and when the adapter reports
 * `idle` or `error` the reply is completed (`session.message_completed`, which
 * prunes its deltas; AD-5) and the state is set. Every session event goes
 * through the session-event helper (E2-R7).
 *
 * Tool calls become `session.tool_call` and `session.tool_call_updated`
 * events, each carrying the whole call as it stands. Permission requests go
 * to {@link Permissions} (the declining stub until 2.6).
 *
 * The agent itself sits behind {@link AgentPort} (AD-1); this file names none.
 * Not yet here: queued messages (E2-R1, 2.10), resume (2.7), permission cards (2.6).
 */
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { ToolCallStatus, ToolKind, type Session, type SessionId, type ToolCallDiff, type Workspace, type WorkspaceId } from '@ogden-agents/shared';
import { monotonicFactory } from 'ulid';
import {
  AgentError,
  type AgentEvent,
  type AgentPermissionDecision,
  type AgentPermissionRequest,
  type AgentPort,
  type AgentSession,
} from './agent-port.js';
import { canonicalWorkspacePath, type Entities } from './entities.js';
import { CoreError, InvalidOperationError, NotFoundError, SessionBusyError } from './errors.js';
import { createDecliningPermissions, type Permissions } from './permissions.js';
import type { SessionEvents } from './session-events.js';

/** The reason on sessions the server moved to `idle` because it stopped or restarted under them (AD-3). */
export const RESTARTED_REASON = 'Ogden Agents was restarted';

export interface ChatOptions {
  entities: Entities;
  /**
   * Ogden Agents' own data folder: never a workspace, nor inside or above
   * one, so an agent can't be pointed at the database, logs or tokens.
   */
  dataDir: string;
  sessionEvents: SessionEvents;
  agent: AgentPort;
  /**
   * Answers the agents' permission requests. Default: the declining stub
   * ({@link createDecliningPermissions}), which denies every request.
   */
  permissions?: Permissions;
  /**
   * The environment each agent process gets (AD-16: API keys go here and
   * nowhere else). Called for every agent start. Default: none.
   */
  agentEnv?: () => Readonly<Record<string, string>>;
  /** Called with every agent failure, for the log. Its `details` hold no secret. */
  onAgentError?: (sessionId: SessionId, error: AgentError) => void;
  /** Called when applying an agent's event failed (such as a session deleted mid-reply), for the log. */
  onInternalError?: (sessionId: SessionId, error: unknown) => void;
}

export interface Chat {
  /**
   * The workspace for the repo at `path`, created if new (AD-2). `path` must
   * be absolute (a leading `~` is the user's home). Throws
   * {@link InvalidOperationError} if it isn't, if it is not an existing
   * folder, or if it is, holds or sits inside Ogden Agents' data folder.
   */
  openWorkspace(path: string): Workspace;
  /** A new chat session in the workspace, `idle`. */
  createChatSession(workspaceId: WorkspaceId): Session;
  /** The session, which must belong to the workspace ({@link NotFoundError} otherwise). */
  getSession(workspaceId: WorkspaceId, sessionId: SessionId): Session;
  /**
   * Stores the user's message and hands it to the session's agent, starting
   * the agent first if needed. Returns once the message is stored; the reply
   * and the state follow through the event log. Throws
   * {@link SessionBusyError} while the agent is still answering, and
   * {@link InvalidOperationError} while the terminal drives the session (AD-6).
   */
  sendMessage(workspaceId: WorkspaceId, sessionId: SessionId, text: string): { messageId: string; queued: boolean };
  /** Resolves once no agent turn is running (tests, shutdown). */
  settled(): Promise<void>;
  /**
   * Ends every agent session and stops their processes (AD-3: the server
   * owns them). Sessions still answering become `idle`, resumable, with
   * {@link RESTARTED_REASON}, before their agents stop.
   */
  close(): Promise<void>;
}

const nextUlid = monotonicFactory();

/** An adapter's tool kind as the shared enum, or `undefined` when it named none or an unknown one. */
const toolKind = (kind: string | undefined): ToolKind | undefined => {
  const parsed = ToolKind.safeParse(kind);
  return parsed.success ? parsed.data : undefined;
};
const toolStatus = (status: string | undefined): ToolCallStatus | undefined => {
  const parsed = ToolCallStatus.safeParse(status);
  return parsed.success ? parsed.data : undefined;
};
const toolCallPayload = (sessionId: SessionId, toolCallId: string, call: ToolCallState) => ({
  sessionId,
  toolCallId,
  title: call.title,
  kind: call.kind,
  status: call.status,
  ...(call.diffs === undefined || call.diffs.length === 0 ? {} : { diffs: call.diffs }),
});
/** Message ids are unique within the install; they are not entity keys. */
const newMessageId = () => `msg_${nextUlid()}`;

/** A tool call as core last recorded it: each event carries the whole call. */
interface ToolCallState {
  title: string;
  kind: ToolKind;
  status: ToolCallStatus;
  diffs: ToolCallDiff[] | undefined;
}

/** One session's live agent, and the reply it is writing, if any. */
interface Live {
  agent: Promise<AgentSession>;
  reply: { messageId: string; text: string } | undefined;
  /** The tool calls this agent session reported, by id. */
  toolCalls: Map<string, ToolCallState>;
  /** Stops listening to the agent. */
  off: (() => void) | undefined;
}

export function createChat(options: ChatOptions): Chat {
  const { entities, sessionEvents, agent } = options;
  const permissions = options.permissions ?? createDecliningPermissions();
  const agentEnv = options.agentEnv ?? (() => ({}));
  const live = new Map<SessionId, Live>();
  /** Sessions whose agent is answering; a second message is refused until it ends. */
  const busy = new Set<SessionId>();
  const turns = new Set<Promise<void>>();
  /** Set by `close`: no event from a stopping agent changes a session any more. */
  let closing = false;
  const dataHome = canonicalWorkspacePath(options.dataDir);

  const internalError = (sessionId: SessionId, error: unknown) => {
    try {
      options.onInternalError?.(sessionId, error);
    } catch {
      // Logging must never break a turn.
    }
  };

  const toAgentError = (error: unknown): AgentError =>
    error instanceof AgentError
      ? error
      : new AgentError('agent_failed', `${agent.displayName} stopped with an error. Try again.`, {
          details: { reason: error instanceof Error ? error.message : String(error) },
          cause: error,
        });

  /** Completes the reply being written, if any, with everything received so far. */
  const finishReply = (sessionId: SessionId, entry: Live) => {
    const reply = entry.reply;
    if (reply === undefined) return;
    entry.reply = undefined;
    sessionEvents.completeMessage(sessionId, { messageId: reply.messageId, role: 'agent', content: reply.text });
  };

  /** Ends the session's agent (it failed or went away); the next message starts a fresh one. */
  const drop = (sessionId: SessionId, entry: Live) => {
    if (live.get(sessionId) === entry) live.delete(sessionId);
    entry.off?.();
    entry.off = undefined;
    entry.agent.then(
      (session) => session.close(),
      () => undefined,
    ).catch((error: unknown) => internalError(sessionId, error));
  };

  /**
   * Puts the session in `error` with the plain reason. `dropAgent` only when
   * the agent's process is gone (or never started): a prompt that merely
   * failed, such as a rate limit, keeps the agent session for the next message.
   */
  const fail = (sessionId: SessionId, entry: Live | undefined, error: AgentError, dropAgent: boolean) => {
    if (closing) return;
    try {
      options.onAgentError?.(sessionId, error);
    } catch {
      // Logging must never hide the failure from the UI.
    }
    try {
      if (entry !== undefined) finishReply(sessionId, entry);
      entities.setSessionState(sessionId, 'error', { reason: error.message });
    } catch (caught) {
      internalError(sessionId, caught);
    }
    if (entry !== undefined && dropAgent) drop(sessionId, entry);
  };

  /** Applies one adapter event to the session (AD-4, AD-5). */
  const apply = (sessionId: SessionId, entry: Live, event: AgentEvent) => {
    if (closing) return;
    try {
      switch (event.type) {
        case 'message_chunk': {
          if (event.text === '') return;
          entry.reply ??= { messageId: newMessageId(), text: '' };
          entry.reply.text += event.text;
          sessionEvents.appendSessionEvent(sessionId, {
            type: 'session.message_delta',
            payload: { messageId: entry.reply.messageId, role: 'agent', text: event.text },
          });
          return;
        }
        case 'state':
          if (event.state === 'working') {
            entities.setSessionState(sessionId, 'working');
          } else if (event.state === 'idle') {
            finishReply(sessionId, entry);
            entities.setSessionState(sessionId, 'idle');
          } else {
            fail(sessionId, entry, new AgentError('agent_failed', event.reason ?? `${agent.displayName} stopped unexpectedly.`), event.fatal === true);
          }
          return;
        case 'tool_call': {
          const call: ToolCallState = {
            title: event.title,
            kind: toolKind(event.kind) ?? 'other',
            status: toolStatus(event.status) ?? 'pending',
            diffs: event.diffs,
          };
          entry.toolCalls.set(event.toolCallId, call);
          sessionEvents.appendSessionEvent(sessionId, {
            type: 'session.tool_call',
            payload: toolCallPayload(sessionId, event.toolCallId, call),
          });
          return;
        }
        case 'tool_call_update': {
          const known = entry.toolCalls.get(event.toolCallId);
          const call: ToolCallState = {
            title: event.title ?? known?.title ?? '',
            kind: toolKind(event.kind) ?? known?.kind ?? 'other',
            status: toolStatus(event.status) ?? known?.status ?? 'pending',
            diffs: event.diffs ?? known?.diffs,
          };
          entry.toolCalls.set(event.toolCallId, call);
          sessionEvents.appendSessionEvent(sessionId, {
            type: 'session.tool_call_updated',
            payload: toolCallPayload(sessionId, event.toolCallId, call),
          });
          return;
        }
      }
    } catch (error) {
      internalError(sessionId, error);
    }
  };

  const agentFor = (session: Session, workspace: Workspace): Live => {
    const existing = live.get(session.id);
    if (existing !== undefined) return existing;
    const entry: Live = { agent: Promise.resolve(undefined as never), reply: undefined, toolCalls: new Map(), off: undefined };
    const onPermissionRequest = async (request: AgentPermissionRequest): Promise<AgentPermissionDecision> => {
      try {
        return await permissions.request(session.id, request);
      } catch (error) {
        // A failure never lets the tool call run.
        internalError(session.id, error);
        return { outcome: 'deny' };
      }
    };
    // The real-cased path: the case-folded key is for uniqueness only (AD-2).
    entry.agent = agent.startSession({ cwd: workspace.realPath ?? workspace.path, env: { ...agentEnv() }, onPermissionRequest }).then(async (started) => {
      if (live.get(session.id) !== entry) {
        // Closed (or dropped) while starting: stop it before anyone waiting on this
        // entry goes on, so `close` returns only once its process has exited.
        await started.close().catch(() => undefined);
        throw new AgentError('agent_failed', `${agent.displayName} was stopped.`);
      }
      entry.off = started.onEvent((event) => apply(session.id, entry, event));
      return started;
    });
    live.set(session.id, entry);
    return entry;
  };

  const runTurn = async (session: Session, workspace: Workspace, text: string): Promise<void> => {
    const entry = agentFor(session, workspace);
    let started: AgentSession;
    try {
      started = await entry.agent;
    } catch (error) {
      fail(session.id, entry, toAgentError(error), true);
      return;
    }
    try {
      await started.prompt(text);
      // The adapter reports `idle` itself; this only covers one that didn't.
      apply(session.id, entry, { type: 'state', state: 'idle' });
    } catch (error) {
      // The adapter has usually reported `error` already; this covers one that didn't.
      // A process that is gone reports `fatal` itself, which drops the agent.
      if (live.get(session.id) === entry) fail(session.id, entry, toAgentError(error), false);
    }
  };

  const getSession = (workspaceId: WorkspaceId, sessionId: SessionId): Session => {
    const session = entities.getSession(sessionId);
    // Another workspace's session is as absent as a missing one: nothing leaks across (AD-2).
    if (session === undefined || session.workspaceId !== workspaceId) throw new NotFoundError('session', sessionId);
    return session;
  };

  return {
    openWorkspace(input) {
      const path = input === '~' ? homedir() : input.startsWith('~/') || input.startsWith('~\\') ? join(homedir(), input.slice(2)) : input;
      if (!isAbsolute(path)) throw new InvalidOperationError('Enter the full path of the folder, starting from the top of the disk.');
      try {
        const candidate = canonicalWorkspacePath(path);
        const within = (inner: string, outer: string) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
        if (within(candidate, dataHome) || within(dataHome, candidate)) {
          throw new InvalidOperationError("That folder holds Ogden Agents' own data, so it can't be a project.");
        }
        return entities.ensureWorkspace(path);
      } catch (error) {
        if (error instanceof CoreError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') throw new InvalidOperationError('There is no folder at that path on this computer.');
        if (code === 'EACCES' || code === 'EPERM') throw new InvalidOperationError("Ogden Agents can't open that folder: permission denied.");
        throw error;
      }
    },

    createChatSession(workspaceId) {
      return entities.createSession({ workspaceId, kind: 'chat' });
    },

    getSession,

    sendMessage(workspaceId, sessionId, text) {
      if (closing) throw new InvalidOperationError('Ogden Agents is stopping.');
      const session = getSession(workspaceId, sessionId);
      const workspace = entities.getWorkspace(workspaceId);
      if (workspace === undefined) throw new NotFoundError('workspace', workspaceId);
      if (session.driver === 'terminal') throw new InvalidOperationError('The terminal is driving this session.');
      if (busy.has(sessionId)) throw new SessionBusyError(sessionId);
      const messageId = newMessageId();
      sessionEvents.completeMessage(sessionId, { messageId, role: 'user', content: text });
      entities.setSessionState(sessionId, 'working');
      busy.add(sessionId);
      const turn = runTurn(session, workspace, text)
        .catch((error: unknown) => internalError(sessionId, error))
        .finally(() => {
          busy.delete(sessionId);
          turns.delete(turn);
        });
      turns.add(turn);
      return { messageId, queued: false };
    },

    async settled() {
      while (turns.size > 0) await Promise.all([...turns]);
    },

    async close() {
      if (!closing) {
        // Before the agents stop, so their exits don't read as crashes.
        for (const sessionId of new Set([...busy, ...live.keys()])) {
          try {
            const state = entities.getSession(sessionId)?.state;
            if (state === 'working' || state === 'waiting') {
              for (const entry of [live.get(sessionId)]) if (entry !== undefined) finishReply(sessionId, entry);
              entities.setSessionState(sessionId, 'idle', { reason: RESTARTED_REASON, resumable: true });
            }
          } catch (error) {
            internalError(sessionId, error);
          }
        }
      }
      closing = true;
      const entries = [...live.entries()];
      live.clear();
      await Promise.all(
        entries.map(async ([sessionId, entry]) => {
          entry.off?.();
          try {
            await (await entry.agent).close();
          } catch (error) {
            if (!(error instanceof AgentError)) internalError(sessionId, error);
          }
        }),
      );
    },
  };
}
