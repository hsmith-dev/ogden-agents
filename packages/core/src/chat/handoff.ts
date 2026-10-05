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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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
import { DriverIsTerminalError, HandoffNotPreviewedError, InvalidOperationError, SessionNotIdleError, UnknownAgentError } from '../errors.js';
import { buildHandoffBrief, HANDOFF_EVENT_TYPES } from '../handoff-brief.js';
import type { Agents } from './agents.js';
import type { Models } from './model.js';
import { AGENT_SESSION_REF, agentSessionRefOf, HANDOFF_PENDING_REF, HANDOFF_PREVIEW_TTL_MS, handoffLeftRefOf, MAX_HANDOFF_PREVIEWS } from './constants.js';
import type { ChatContext } from './context.js';
import type { Chat } from './types.js';
import { requireAgentReady } from './workspaces.js';

export function createHandoff(ctx: ChatContext, deps: Pick<Agents, 'releaseAgent' | 'storedAgentSessionId'> & Pick<Chat, 'sendMessage'> & Pick<Models, 'initialModel'>) {
  const { entities, agents, busy, switching, sessionModes, getSession, getWorkspace } = ctx;
  const { releaseAgent, storedAgentSessionId, sendMessage, initialModel } = deps;

  /**
   * The previews shown and not yet used, by token (in memory: a restart
   * forgets them, and the user previews again). Each binds the chat, the
   * agent, the mode change it states and the exact masked brief, by hash.
   */
  const previews = new Map<string, { digest: Buffer; expiresAt: number }>();
  const ttlMs = ctx.options.handoffPreviewTtlMs ?? HANDOFF_PREVIEW_TTL_MS;
  const digestOf = (sessionId: SessionId, agentId: AgentId, mode: string, told: string) =>
    createHash('sha256').update([sessionId, agentId, mode, told].join('\u0000')).digest();
  /** A new single-use token for exactly this preview. */
  const issue = (sessionId: SessionId, agentId: AgentId, mode: string, told: string): string => {
    const now = Date.now();
    for (const [token, preview] of previews) if (preview.expiresAt <= now) previews.delete(token);
    // Bounded: the oldest go first.
    while (previews.size >= MAX_HANDOFF_PREVIEWS) previews.delete(previews.keys().next().value!);
    const token = randomBytes(32).toString('base64url');
    previews.set(token, { digest: digestOf(sessionId, agentId, mode, told), expiresAt: now + ttlMs });
    return token;
  };
  /** Uses up `token`: whether it was issued for exactly this handoff and hasn't expired. */
  const redeem = (token: string, sessionId: SessionId, agentId: AgentId, mode: string, told: string): boolean => {
    const preview = previews.get(token);
    previews.delete(token);
    if (preview === undefined || preview.expiresAt <= Date.now()) return false;
    return timingSafeEqual(preview.digest, digestOf(sessionId, agentId, mode, told));
  };
  /** The brief as it would be sent: masked again and trimmed, refused over the agent's budget. */
  const finalBrief = (brief: string, maxChars: number, name: string): string => {
    const tooLong = `The brief is too long for ${name}: it can be at most ${maxChars} characters.`;
    // Far over the budget is refused before any work on it.
    if (brief.length > maxChars * 2) throw new InvalidOperationError(tooLong);
    // Masked again: what the user edited goes to another provider (AD-16).
    const told = redactSecrets(brief).trim();
    if (told.length > maxChars) throw new InvalidOperationError(tooLong);
    return told;
  };

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
    async handoffPreview(workspaceId, sessionId, agentId, edited): Promise<HandoffPreviewResponse> {
      const { session, descriptor, brief: built, maxChars, permissionMode, modeNote, resumes } = await prepare(workspaceId, sessionId, agentId);
      // The brief as built, or as the user edited it: the token covers exactly what is shown.
      const brief = finalBrief(edited ?? built, maxChars, descriptor.displayName);
      return {
        agent: { agentId, displayName: descriptor.displayName, provider: descriptor.provider },
        brief,
        maxChars,
        permissionMode,
        ...(modeNote === undefined ? {} : { modeNote }),
        resumes,
        // Bound to the mode change it states (from, to): a mode changed since is previewed again.
        previewToken: issue(sessionId, agentId, `${session.permissionMode}>${permissionMode}`, brief),
      };
    },

    async handOff(workspaceId, sessionId, { agentId, brief, message, previewToken, model }) {
      const prepared = await prepare(workspaceId, sessionId, agentId);
      const { current, descriptor, ownSession, resumes, maxChars, permissionMode, modeNote } = prepared;
      const told = finalBrief(brief, maxChars, descriptor.displayName);
      if (message.trim() === '') throw new InvalidOperationError('Write a message for the agent first.');
      // Sent only as previewed (server-enforced disclosure): this chat, this agent, this mode, this exact brief; once.
      if (!redeem(previewToken, sessionId, agentId, `${prepared.session.permissionMode}>${permissionMode}`, told)) throw new HandoffNotPreviewedError();
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
        // The chat's model is the new agent's (story 11 + handoff): the one chosen with the handoff, else the
        // project's default for that agent, else the install's, else its own choice. Another agent's model id never carries over.
        entities.setSessionModel(sessionId, model !== undefined ? model : initialModel(workspaceId, agentId), 'user');
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
