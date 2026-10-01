/**
 * The sessions' agents (moved from `chat.ts`, story 3.11): starting one, or
 * reopening the chat's earlier agent session (2.7), what it is prompted with,
 * and dropping or releasing it. `apply` comes from the turn that starts the
 * agent, so this module never imports the turns.
 */
import type { Session, SessionId, Workspace } from '@ogden-agents/shared';
import { AgentError, type AgentEvent, type AgentRestored, type AgentSession } from '../agent-port.js';
import { primedPrompt } from '../resume-prime.js';
import { AGENT_SESSION_REF } from './constants.js';
import type { ChatContext } from './context.js';
import type { PermissionRequests } from './permission-requests.js';
import type { Replies } from './replies.js';
import type { Live } from './types.js';

export function createAgents(ctx: ChatContext, deps: Pick<Replies, 'stopDeltaTimer'> & Pick<PermissionRequests, 'onPermissionRequestFor'>) {
  const { entities, sessionEvents, agent, agentEnv, live, droppedAgents, internalError } = ctx;
  const { stopDeltaTimer, onPermissionRequestFor } = deps;

  /** Ends the session's agent (it failed or went away); the next message starts a fresh one. */
  const drop = (sessionId: SessionId, entry: Live) => {
    if (live.get(sessionId) === entry) live.delete(sessionId);
    stopDeltaTimer(entry);
    entry.off?.();
    entry.off = undefined;
    entry.markGone();
    const before = droppedAgents.get(sessionId);
    const stopped: Promise<void> = Promise.all([
      before,
      entry.agent.then(
        (session) => session.close(),
        () => undefined,
      ),
    ])
      .then(() => undefined)
      .catch((error: unknown) => internalError(sessionId, error))
      .finally(() => {
        if (droppedAgents.get(sessionId) === stopped) droppedAgents.delete(sessionId);
      });
    droppedAgents.set(sessionId, stopped);
  };

  /** The session's current adapter ref for its agent session, if it ever reached an agent. */
  const storedAgentSessionId = (sessionId: SessionId): string | undefined => {
    const ref = entities.getSession(sessionId)?.adapterRefs[AGENT_SESSION_REF];
    return ref === undefined || ref === '' ? undefined : ref;
  };

  const agentFor = (session: Session, workspace: Workspace, apply: (sessionId: SessionId, entry: Live, event: AgentEvent) => void): Live => {
    const existing = live.get(session.id);
    if (existing !== undefined) return existing;
    let markGone!: () => void;
    const gone = new Promise<void>((resolve) => (markGone = resolve));
    const entry: Live = {
      agent: Promise.resolve(undefined as never),
      reply: undefined,
      pendingDelta: '',
      deltaTimer: undefined,
      toolCalls: new Map(),
      off: undefined,
      prime: false,
      unsavedRef: undefined,
      gone,
      markGone,
    };
    const onPermissionRequest = onPermissionRequestFor(session);
    // The real-cased path: the case-folded key is for uniqueness only (AD-2).
    const input = { cwd: workspace.realPath ?? workspace.path, env: { ...agentEnv() }, onPermissionRequest };
    const previous = storedAgentSessionId(session.id);
    // A chat that reached an agent before, and has none now, reopens that agent's session (2.7).
    // A dropped agent of this session stops first: never two of its processes at once.
    const begin = (): Promise<{ session: AgentSession; restored: AgentRestored | undefined }> =>
      previous === undefined
        ? agent.startSession(input).then((started) => ({ session: started, restored: undefined }))
        : agent.reopenSession({ ...input, agentSessionId: previous });
    const dropped = droppedAgents.get(session.id);
    const opening = dropped === undefined ? begin() : dropped.then(begin);
    entry.agent = opening.then(async ({ session: started, restored }) => {
      if (live.get(session.id) !== entry) {
        // Closed (or dropped) while starting: stop it before anyone waiting on this
        // entry goes on, so `close` returns only once its process has exited.
        await started.close().catch(() => undefined);
        throw new AgentError('agent_failed', `${agent.displayName} was stopped.`);
      }
      try {
        // The id stays an adapter ref: it is in no event (AD-9). A new session in
        // place of the earlier one is saved only once its primed prompt succeeded (2.7 F4).
        if (restored === 'new') entry.unsavedRef = started.agentSessionId;
        else if (started.agentSessionId !== previous) entities.setSessionAdapterRefs(session.id, { [AGENT_SESSION_REF]: started.agentSessionId });
        if (restored !== undefined) {
          sessionEvents.appendSessionEvent(session.id, {
            type: 'session.resumed',
            payload: { sessionId: session.id, via: restored === 'new' ? 'transcript' : restored },
          });
        }
      } catch (error) {
        await started.close().catch(() => undefined);
        throw error;
      }
      entry.prime = restored === 'new';
      entry.off = started.onEvent((event) => apply(session.id, entry, event));
      return started;
    });
    live.set(session.id, entry);
    return entry;
  };

  /**
   * What the agent is sent for the user's `text`: the text itself, or, on a
   * session that replaced the chat's earlier one, the text after the chat's
   * transcript up to (not including) this message. A slash command (`/…`)
   * goes as it is, so the agent still reads it as a command, and the next
   * ordinary message is primed instead (review F1). `primed` says which.
   */
  const promptFor = (sessionId: SessionId, entry: Live, messageId: string, text: string): { prompt: string; primed: boolean } => {
    if (!entry.prime || text.trimStart().startsWith('/')) return { prompt: text, primed: false };
    const earlier = entities.listCompletedMessages(sessionId).filter((message) => message.messageId !== messageId);
    return { prompt: primedPrompt(earlier, text, agent.displayName), primed: true };
  };

  /** Releases the session's agent process and waits for it to exit, so the CLI never shares the session with it. */
  const releaseAgent = async (sessionId: SessionId): Promise<void> => {
    // The same drop as a failure's (9.4): the CLI starts only once this agent, and any dropped before, has stopped.
    const entry = live.get(sessionId);
    if (entry !== undefined) drop(sessionId, entry);
    await droppedAgents.get(sessionId);
  };

  return { drop, storedAgentSessionId, agentFor, promptFor, releaseAgent };
}

export type Agents = ReturnType<typeof createAgents>;
