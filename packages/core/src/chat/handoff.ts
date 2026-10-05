/**
 * Handoff (user decision 2026-10-04): the user continues a chat with another
 * agent, typically because its agent ran out of usage, in the same chat.
 *
 * {@link Handoff.handoffPreview} builds the brief from the chat's own events
 * (`handoff-brief.ts`, no model call) and says who receives it and the mode
 * the chat would be in; nothing changes. {@link Handoff.handOff} takes the
 * brief as the user confirmed it (masked again, refused over the target's
 * budget), stops the chat's agent, carries the permission mode when the
 * target declares it (else Ask, cause `handoff`), and switches the session's
 * agent with one `session.agent_changed` event. Each agent keeps its own
 * agent session in an adapter ref, so an agent the chat comes back to reopens
 * the session it had, and is told only what happened since it left. The
 * brief goes with the next prompt (`HANDOFF_PENDING_REF`), sent at once with
 * the user's message; a restart before that prompt succeeded sends it with
 * the next one.
 *
 * Refused, changing nothing: while the terminal drives, while the chat works,
 * waits or switches, for its own agent or an unknown one, and for an agent
 * that can't take a chat in this project now (trust, install, sign-in).
 */
import {
  PERMISSION_MODE_LABELS,
  redactSecrets,
  type AgentId,
  type HandoffPreviewResponse,
  type PermissionMode,
  type Session,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { declaredModes, handoffBudget, type AgentDescriptor } from '../agent-descriptor.js';
import { DriverIsTerminalError, InvalidOperationError, SessionNotIdleError, UnknownAgentError } from '../errors.js';
import { buildHandoffBrief, HANDOFF_EVENT_TYPES } from '../handoff-brief.js';
import type { Agents } from './agents.js';
import { AGENT_SESSION_REF, agentSessionRefOf, HANDOFF_PENDING_REF, handoffLeftRefOf } from './constants.js';
import type { ChatContext } from './context.js';
import type { Chat } from './types.js';
import { requireAgentReady } from './workspaces.js';

export function createHandoff(ctx: ChatContext, deps: Pick<Agents, 'releaseAgent' | 'storedAgentSessionId'> & Pick<Chat, 'sendMessage'>) {
  const { entities, agents, busy, switching, sessionModes, getSession, getWorkspace } = ctx;
  const { releaseAgent, storedAgentSessionId, sendMessage } = deps;

  const nameOf = (agentId: AgentId | undefined): string => agents.describe(agentId ?? agents.legacyAgentId)?.displayName ?? "This chat's earlier agent";

  /** Refuses a handoff the chat can't take now (no await: the state as it is). Returns the session and its agent's id. */
  const checkNow = (workspaceId: WorkspaceId, sessionId: SessionId, agentId: AgentId): { session: Session; current: AgentId } => {
    const session = getSession(workspaceId, sessionId);
    const current = ctx.agentIdOf(session);
    if (switching.has(sessionId)) throw new SessionNotIdleError('This chat is switching to or from the terminal. Try again in a moment.');
    if (session.driver === 'terminal') {
      throw new DriverIsTerminalError('The terminal is driving this chat. Switch back to the chat before continuing with another agent.');
    }
    if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
    if (session.state === 'waiting') throw new SessionNotIdleError(`${nameOf(current)} is waiting for your answer in this chat. Answer it or stop it first.`);
    if (busy.has(sessionId) || session.state === 'working') {
      throw new SessionNotIdleError(`${nameOf(current)} is still working in this chat. Stop it first, then continue with another agent.`);
    }
    if (session.state !== 'idle' && session.state !== 'error') throw new SessionNotIdleError('This chat is finished, so it can’t continue with another agent.');
    if (agents.get(agentId) === undefined || agents.describe(agentId) === undefined) throw new UnknownAgentError();
    if (agentId === current) throw new InvalidOperationError(`This chat is already with ${nameOf(current)}.`);
    return { session, current };
  };

  /**
   * The chat's mode with `descriptor`'s agent: its own when the agent declares
   * it (and, once one of its sessions started this run, that session offered
   * it too, as the mode picker judges), else Ask, with why.
   */
  const modeWith = (mode: PermissionMode, descriptor: AgentDescriptor): { permissionMode: PermissionMode; modeNote?: string } => {
    const seen = ctx.lastSessionModes.get(descriptor.agentId);
    const offered = declaredModes(descriptor).includes(mode) && (seen === undefined || seen.includes(mode));
    return offered ? { permissionMode: mode } : { permissionMode: 'ask', modeNote: `${descriptor.displayName} doesn't offer ${PERMISSION_MODE_LABELS[mode]} here, so this chat will be in Ask.` };
  };

  /** Everything a handoff to `agentId` would send, once the checks passed. */
  const prepare = async (workspaceId: WorkspaceId, sessionId: SessionId, agentId: AgentId) => {
    checkNow(workspaceId, sessionId, agentId);
    const descriptor = agents.describe(agentId)!;
    await requireAgentReady(ctx, workspaceId, agentId, descriptor);
    // The chat may have moved on while the readiness was read.
    const { session, current } = checkNow(workspaceId, sessionId, agentId);
    const workspace = getWorkspace(workspaceId);
    const ownSession = session.adapterRefs[agentSessionRefOf(agentId)] ?? '';
    const resumes = ownSession !== '';
    const leftAt = Number(session.adapterRefs[handoffLeftRefOf(agentId)] ?? '');
    const maxChars = handoffBudget(descriptor);
    const brief = buildHandoffBrief({
      events: entities.listSessionEvents(sessionId, HANDOFF_EVENT_TYPES),
      projectPath: workspace.realPath ?? workspace.path,
      agentName: nameOf,
      fromName: nameOf(current),
      sinceSeq: resumes && Number.isInteger(leftAt) && leftAt > 0 ? leftAt : undefined,
      maxChars,
    });
    return { session, current, descriptor, ownSession, resumes, maxChars, brief, ...modeWith(session.permissionMode, descriptor) };
  };

  const methods: Pick<Chat, 'handoffPreview' | 'handOff'> = {
    async handoffPreview(workspaceId, sessionId, agentId): Promise<HandoffPreviewResponse> {
      const { descriptor, brief, maxChars, permissionMode, modeNote, resumes } = await prepare(workspaceId, sessionId, agentId);
      return {
        agent: { agentId, displayName: descriptor.displayName, provider: descriptor.provider },
        brief,
        maxChars,
        permissionMode,
        ...(modeNote === undefined ? {} : { modeNote }),
        resumes,
      };
    },

    async handOff(workspaceId, sessionId, { agentId, brief, message }) {
      const prepared = await prepare(workspaceId, sessionId, agentId);
      const { current, descriptor, ownSession, resumes, maxChars, permissionMode, modeNote } = prepared;
      // Masked again: what the user edited goes to another provider (AD-16).
      const told = redactSecrets(brief).trim();
      if (told.length > maxChars) throw new InvalidOperationError(`The brief is too long for ${descriptor.displayName}: it can be at most ${maxChars} characters.`);
      if (message.trim() === '') throw new InvalidOperationError('Write a message for the agent first.');
      // Held like a driver switch: no message is taken and no other switch starts until it is done.
      switching.add(sessionId);
      try {
        // The chat's agent stops first: never two agents on one chat.
        await releaseAgent(sessionId);
        sessionModes.delete(sessionId);
        const leaving = storedAgentSessionId(sessionId) ?? '';
        if (permissionMode !== prepared.session.permissionMode) entities.setSessionPermissionMode(sessionId, permissionMode, 'handoff', modeNote);
        entities.setSessionAgent(sessionId, {
          agentId,
          previous: current,
          brief: told,
          resumes,
          refs: {
            // The agent that leaves keeps its session for when the chat comes back to it; the new one reopens its own, if it had one.
            [agentSessionRefOf(current)]: leaving,
            [AGENT_SESSION_REF]: ownSession,
            [HANDOFF_PENDING_REF]: told === '' ? '' : '1',
          },
          // Where the leaving agent left, in the same transaction: its brief on return starts after it.
          leftAtRef: handoffLeftRefOf(current),
        });
      } finally {
        switching.delete(sessionId);
      }
      // The first message goes to the new provider too: masked like the brief.
      const { messageId } = sendMessage(workspaceId, sessionId, redactSecrets(message));
      return { session: ctx.withAgentId(getSession(workspaceId, sessionId)), messageId };
    },
  };

  return methods;
}
