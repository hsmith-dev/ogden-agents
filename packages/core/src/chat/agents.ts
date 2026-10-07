/**
 * The sessions' agents (moved from `chat.ts`, story 3.11): starting one, or
 * reopening the chat's earlier agent session (2.7), what it is prompted with,
 * and dropping or releasing it. `apply` comes from the turn that starts the
 * agent, so this module never imports the turns.
 */
import { projectNotTrustedReason, redactSecrets, type Session, type SessionId, type Workspace } from '@ogden-agents/shared';
import { AgentError, type AgentEvent, type AgentPermissionRequest, type AgentRestored, type AgentSession } from '../agent-port.js';
import { PRIME_NEW_MESSAGE, primedPrompt } from '../resume-prime.js';
import { AGENT_SESSION_REF, AGENT_STARTING_NOTICE_MS, HANDOFF_PENDING_REF } from './constants.js';
import type { ChatContext } from './context.js';
import type { Models } from './model.js';
import type { ModeApplier } from './permission-mode.js';
import type { PermissionRequests } from './permission-requests.js';
import type { Replies } from './replies.js';
import type { Live } from './types.js';

export function createAgents(
  ctx: ChatContext,
  deps: Pick<Replies, 'stopDeltaTimer'> & Pick<PermissionRequests, 'onPermissionRequestFor'> & Pick<Models, 'noteStarted' | 'takesModelAtStart' | 'startModelFor'> & { applyMode: ModeApplier },
) {
  const { entities, sessionEvents, agentEnv, agentOf, agentIdOf, live, droppedAgents, internalError, sessionModes, later } = ctx;
  const { stopDeltaTimer, onPermissionRequestFor, applyMode, noteStarted, takesModelAtStart, startModelFor } = deps;

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
    // Called before each prompt, an idle point: an agent whose guards no longer fit the chat's mode restarts here.
    if (existing !== undefined && existing.restartPending) drop(session.id, existing);
    else if (existing !== undefined) return existing;
    // The chat's mode as this start reads it: agents that fix their mode at start get it now (epic 12, 12.3).
    const startMode = entities.getSession(session.id)?.permissionMode ?? 'ask';
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
      modeSync: Promise.resolve(),
      // The protected paths stay guarded in Auto ("Keep protected files guarded", user decision 2026-10-02); fixed for the session's life.
      guardsRequested: startMode === 'auto',
      restartPending: false,
      appliedModel: null,
    };
    // A `build` session (story 5.2) runs in its run's worktree, in its sandbox, and its permission
    // requests are answered by core's build policy, never a card. Without its setup it never starts.
    const build = session.kind === 'build' ? ctx.options.buildSessions?.get(session.id) : undefined;
    // An attended build (story 5.6) is the user's: every tool call is a card at the `ask_every_time` level, no rule allows one.
    const unattended = build === undefined || build.attended === true ? undefined : build;
    const onPermissionRequest =
      build === undefined ? onPermissionRequestFor(session) : unattended === undefined ? onPermissionRequestFor(session, { attended: true }) : async (request: AgentPermissionRequest) => unattended.decide(request);
    // The agent the session was started with (epic 6), looked up for each start: never another one.
    const agent = agentOf(session.id);
    const agentId = agentIdOf(session);
    // An agent that takes its model only at start gets the chat's in its start (story 11); one told live starts on its own choice.
    const startModel = takesModelAtStart(agentId) ? startModelFor(session.id, agentId) : null;
    entry.appliedModel = startModel;
    // The real-cased path: the case-folded key is for uniqueness only (AD-2).
    const input = {
      cwd: build?.cwd ?? workspace.realPath ?? workspace.path,
      env: { ...agentEnv(session.id), ...unattended?.env },
      onPermissionRequest,
      permissionMode: startMode,
      ...(entry.guardsRequested ? { protectedPaths: ctx.protectedPaths() } : {}),
      ...(startModel === null ? {} : { model: startModel }),
      ...(unattended === undefined ? {} : { sandbox: unattended.sandbox }),
      ...(build?.attended === true ? { attended: true as const } : {}),
      mcpServers: ctx.installSettings?.globalMcpServers() ?? [],
    };
    const previous = storedAgentSessionId(session.id);
    // A chat that reached an agent before, and has none now, reopens that agent's session (2.7).
    // A dropped agent of this session stops first: never two of its processes at once.
    const needsTrust = ctx.agents.describe(agentId)?.needsProjectTrust === true;
    const begin = async (): Promise<{ session: AgentSession; restored: AgentRestored | undefined }> => {
      // An agent that runs the project's own settings and hooks starts only in a project trusted as it is now: asked at every
      // start, not only when the chat was made, so a changed `.mcp.json` asks again before the next start (epic 12, 12.3).
      if (needsTrust && !(await ctx.projectTrusted(workspace.id))) throw new AgentError('agent_unavailable', projectNotTrustedReason(agent.displayName));
      if (session.kind === 'build' && build === undefined) {
        throw new AgentError('agent_unavailable', `${agent.displayName} can't run this build any more. Build the ticket again from the board.`);
      }
      return previous === undefined
        ? agent.startSession(input).then((started) => ({ session: started, restored: undefined }))
        : agent.reopenSession({ ...input, agentSessionId: previous });
    };
    const dropped = droppedAgents.get(session.id);
    const opening = dropped === undefined ? begin() : dropped.then(begin);
    // A start that takes a while shows as starting, not stuck (epic 6 entry 5); a quick one adds no event.
    const announce = (type: 'session.agent_starting' | 'session.agent_started') => {
      try {
        sessionEvents.appendSessionEvent(session.id, { type, payload: { sessionId: session.id } });
      } catch (error) {
        internalError(session.id, error);
      }
    };
    let starting: 'pending' | 'announced' | 'ended' = 'pending';
    const startingTimer = later(AGENT_STARTING_NOTICE_MS, () => {
      if (starting !== 'pending' || live.get(session.id) !== entry) return;
      starting = 'announced';
      announce('session.agent_starting');
    });
    const startEnded = () => {
      clearTimeout(startingTimer);
      if (starting === 'announced') announce('session.agent_started');
      starting = 'ended';
    };
    opening.then(startEnded, startEnded);
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
      sessionModes.set(session.id, started.permissionModes ?? ['ask']);
      ctx.lastSessionModes.set(agentId, started.permissionModes ?? ['ask']);
      // What it lists (story 11): the chat's picker, and the agent's last list for Settings.
      noteStarted(session.id, agentId, started);
      // The chat's stored mode before the first prompt, whatever the agent's own settings started it in
      // (a new chat, and every chat after a restart, in Ask). One it can't be put in, not even Ask, is stopped.
      const applied = await applyMode(session.id, started, entry.guardsRequested);
      // The mode changed while it started, across the guards: it runs in Ask, and restarts before the next prompt.
      if (applied === 'restart') entry.restartPending = true;
      if (applied === 'failed') {
        entry.off();
        entry.off = undefined;
        await started.close().catch(() => undefined);
        throw new AgentError('agent_failed', `${agent.displayName} couldn't start in this chat's permission mode. Try again.`);
      }
      if (live.get(session.id) !== entry) {
        await started.close().catch(() => undefined);
        throw new AgentError('agent_failed', `${agent.displayName} was stopped.`);
      }
      return started;
    });
    live.set(session.id, entry);
    return entry;
  };

  /** The brief of the chat's latest handoff while it is still to be sent (handoff), else `undefined`. */
  const pendingBrief = (sessionId: SessionId): string | undefined => {
    if (entities.getSession(sessionId)?.adapterRefs[HANDOFF_PENDING_REF] !== '1') return undefined;
    const changed = entities.listSessionEvents(sessionId, ['session.agent_changed']).at(-1);
    return changed?.type === 'session.agent_changed' && changed.payload.brief.trim() !== '' ? changed.payload.brief : undefined;
  };

  /**
   * What the agent is sent for the user's `text`: the text itself, or, on a
   * session that replaced the chat's earlier one, the text after the chat's
   * transcript up to (not including) this message. After a handoff, the
   * brief goes first (`handoff`), until a prompt with it succeeded. A slash
   * command (`/…`) goes as it is, so the agent still reads it as a command,
   * and the next ordinary message is primed instead (review F1). `primed`
   * says which.
   */
  const promptFor = (sessionId: SessionId, entry: Live, messageId: string, text: string): { prompt: string; primed: boolean; handoff: boolean } => {
    const invocation = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trimStart());
    const skill = invocation === null ? undefined : ctx.installSettings?.globalSkills().find((item) => item.name === invocation[1]);
    if (skill !== undefined) text = `Run the shared skill ${skill.name}.\n\n${skill.content}\n\nUser input:\n${invocation?.[2] ?? ''}`;
    if (skill === undefined && text.trimStart().startsWith('/')) return { prompt: text, primed: false, handoff: false };
    const brief = pendingBrief(sessionId);
    const told = brief === undefined ? text : `${brief}\n${PRIME_NEW_MESSAGE}\n${text}`;
    if (!entry.prime) return { prompt: told, primed: false, handoff: brief !== undefined };
    const stored = entities.listCompletedMessages(sessionId).filter((message) => message.messageId !== messageId);
    // After a handoff the transcript may hold another provider's chat: masked like the brief (AD-16).
    const earlier = brief === undefined ? stored : stored.map((message) => ({ ...message, content: redactSecrets(message.content) }));
    return { prompt: primedPrompt(earlier, told, agentOf(sessionId).displayName), primed: true, handoff: brief !== undefined };
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
