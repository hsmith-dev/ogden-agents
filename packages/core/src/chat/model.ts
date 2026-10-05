/**
 * A chat's model (story 11: each chat runs on a model the user can switch):
 * the agent's own id for it, or `null` for the agent's own choice, stored on
 * the session and changed only by core, each change a `session.model_changed`
 * event. Core names no agent and no model.
 *
 * - A new chat starts on the project's default for its agent, else the
 *   install's, else `null` (`initialModel`).
 * - The stored model reaches the agent at the idle point before each prompt
 *   (`syncModel`), so a switch never interrupts a running turn: told live
 *   when the session can switch (`AgentSession.setModel`), else the agent is
 *   restarted (resumed) there with the model in its start.
 * - A model the agent refuses moves the chat back to `null` (cause `agent`)
 *   with the agent's own words, and the prompt goes out on its default. A
 *   model the agent reports switching to by itself, on a chat that chose
 *   one, becomes the chat's (cause `agent`).
 */
import { ModelId as ModelIdSchema, type AgentId, type AgentModel, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import { AgentError, type AgentEvent, type AgentSession } from '../agent-port.js';
import { DriverIsTerminalError, InvalidOperationError, ModelUnavailableError, SessionNotIdleError, ValidationError } from '../errors.js';
import type { ChatContext } from './context.js';
import type { Chat, Live, Timer } from './types.js';

/** The most of an agent's own refusal kept in the chat's reason. */
const MAX_REASON_CHARS = 300;

/** A model by the agent's name for it, when its list has it, else by its id. */
export const modelName = (list: readonly AgentModel[] | undefined, model: string): string => list?.find((each) => each.id === model)?.name ?? model;

export function createModels(ctx: ChatContext) {
  const { entities, agents, agentOf, agentIdOf, internalError, later, sessionModels, switching, getSession } = ctx;

  /** The models the chat can be put on: its agent session's this run, else the agent's last list. */
  const listFor = (sessionId: SessionId): readonly AgentModel[] | undefined => {
    const listed = sessionModels.get(sessionId)?.available;
    if (listed !== undefined && listed.length > 0) return listed;
    const session = entities.getSession(sessionId);
    return session === undefined ? undefined : ctx.agentModelList(agentIdOf(session));
  };

  /** Whether the agent takes its model only at start (its descriptor's static list). */
  const takesModelAtStart = (agentId: AgentId) => agents.describe(agentId)?.models !== undefined;

  /** The model a new chat with `agentId` in the workspace starts on: the project's default, else the install's, else `null`. */
  const initialModel = (workspaceId: WorkspaceId, agentId: AgentId): string | null => {
    let project: string | undefined;
    try {
      project = ctx.permissions.getSettings(workspaceId).defaultModels?.[agentId];
    } catch {
      project = undefined;
    }
    return project ?? ctx.options.agentModels?.defaultModel(agentId) ?? null;
  };

  /** The agent's own refusal, in plain words, capped (its message is already masked by the adapter). */
  const refusal = (error: unknown): string | undefined => {
    const message = error instanceof AgentError ? error.message.trim() : '';
    if (message === '') return undefined;
    return message.length > MAX_REASON_CHARS ? `${message.slice(0, MAX_REASON_CHARS - 1)}…` : message;
  };

  /** How `promise` settled within the bound: `ok`, the refusal, or `timeout`. */
  const bounded = async (promise: Promise<void>): Promise<{ ok: true } | { ok: false; error: unknown } | 'timeout'> => {
    let timer: Timer | undefined;
    try {
      return await Promise.race([
        promise.then(
          () => ({ ok: true }) as const,
          (error: unknown) => ({ ok: false, error }) as const,
        ),
        new Promise<'timeout'>((resolve) => (timer = later(ctx.permissionModeTimeoutMs, () => resolve('timeout')))),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * Puts the live agent on the chat's stored model before a prompt (an idle
   * point). Returns `restart` when it takes its model only at start and that
   * differs: the caller restarts it (resumed) first. Never rejects.
   */
  const syncModel = async (sessionId: SessionId, entry: Live, started: AgentSession): Promise<'ok' | 'restart'> => {
    // At most twice: the stored model, then (refused) the agent's own choice.
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = entities.getSession(sessionId);
      if (session === undefined) return 'ok';
      const want = session.model ?? null;
      if (want === entry.appliedModel) return 'ok';
      if (started.setModel === undefined) {
        if (takesModelAtStart(agentIdOf(session))) return 'restart';
        // It offers no way to choose: the chat runs on its own choice.
        entry.appliedModel = want;
        return 'ok';
      }
      const result = await bounded(Promise.resolve().then(() => started.setModel!(want)));
      if (result === 'timeout') {
        // It may still switch mid-turn: never prompted like this. Restarted (resumed) first, and told again.
        internalError(sessionId, new AgentError('agent_failed', 'model_timeout'));
        entry.appliedModel = undefined;
        return 'restart';
      }
      if (result.ok) {
        entry.appliedModel = want;
        const now = started.models?.current;
        const known = sessionModels.get(sessionId);
        if (known !== undefined && now !== undefined) sessionModels.set(sessionId, { ...known, current: now });
        return 'ok';
      }
      internalError(sessionId, result.error);
      if (want === null) {
        // Even its own choice was refused: leave it as it is.
        entry.appliedModel = null;
        return 'ok';
      }
      try {
        // Only if the chat still says that model: a newer choice is applied in its own turn.
        if ((entities.getSession(sessionId)?.model ?? null) === want) {
          const name = agentOf(sessionId).displayName;
          const why = refusal(result.error);
          const label = modelName(listFor(sessionId), want);
          entities.setSessionModel(
            sessionId,
            null,
            'agent',
            why === undefined ? `${name} couldn't switch to ${label}, so this chat uses ${name}'s default.` : `${name} couldn't switch to ${label}: ${why} This chat uses ${name}'s default.`,
          );
        }
      } catch (error) {
        internalError(sessionId, error);
        return 'ok';
      }
    }
    return 'ok';
  };

  /** The agent reports running on another model by itself (story 11): a chat that chose one follows it. */
  const onReportedModel = (sessionId: SessionId, entry: Live, event: Extract<AgentEvent, { type: 'model' }>): void => {
    const session = entities.getSession(sessionId);
    if (session === undefined) return;
    const current = sessionModels.get(sessionId);
    if (current !== undefined) sessionModels.set(sessionId, { ...current, current: event.model });
    const parsed = ModelIdSchema.safeParse(event.model);
    if (!parsed.success) return;
    const stored = session.model ?? null;
    // A choice the user made since the agent was last told waits for the next idle point: the report doesn't replace it.
    const pending = stored !== entry.appliedModel;
    entry.appliedModel = parsed.data;
    if (stored === null || stored === parsed.data || pending) return;
    const name = agentOf(sessionId).displayName;
    entities.setSessionModel(sessionId, parsed.data, 'agent', `${name} switched itself to ${modelName(listFor(sessionId), parsed.data)}.`);
  };

  /**
   * The model an agent that takes one only at start is started on: the
   * chat's, when its descriptor lists it; one it doesn't list moves the chat
   * to its default (cause `agent`) with a plain reason, so the chat never
   * shows a model the agent isn't running.
   */
  const startModelFor = (sessionId: SessionId, agentId: AgentId): string | null => {
    const want = entities.getSession(sessionId)?.model ?? null;
    const list = agents.describe(agentId)?.models?.list;
    if (want === null || list === undefined || list.some((each) => each.id === want)) return want;
    try {
      const name = agentOf(sessionId).displayName;
      entities.setSessionModel(sessionId, null, 'agent', `${name} doesn't offer ${want}, so this chat uses ${name}'s default.`);
    } catch (error) {
      internalError(sessionId, error);
    }
    return null;
  };

  /** Records what a started agent session lists (this run, and the agent's last list). */
  const noteStarted = (sessionId: SessionId, agentId: AgentId, started: AgentSession): void => {
    const models = started.models;
    if (models === undefined) {
      sessionModels.delete(sessionId);
      return;
    }
    sessionModels.set(sessionId, { available: [...models.available], ...(models.current === undefined ? {} : { current: models.current }) });
    try {
      ctx.rememberModels(agentId, models.available);
    } catch (error) {
      internalError(sessionId, error);
    }
  };

  const methods: Pick<Chat, 'setModel' | 'modelOptions'> = {
    setModel(workspaceId, sessionId, model) {
      if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
      const session = getSession(workspaceId, sessionId);
      const parsed = ModelIdSchema.nullable().safeParse(model);
      if (!parsed.success) throw new ValidationError("Choose a model the agent offers, or the agent's default.", [{ path: ['model'], message: 'not a model id' }]);
      if (session.driver === 'terminal') throw new DriverIsTerminalError('The terminal is driving this chat. Switch back to the chat to change its model.');
      if (switching.has(sessionId)) throw new SessionNotIdleError('This chat is switching to or from the terminal. Try again in a moment.');
      if ((session.model ?? null) === parsed.data) return session;
      const list = listFor(sessionId);
      if (parsed.data !== null && list !== undefined && !list.some((each) => each.id === parsed.data)) {
        throw new ModelUnavailableError(`${agentOf(sessionId).displayName} doesn't offer that model here. Choose one from the list.`);
      }
      // Applied before the agent's next prompt: never mid-turn.
      return entities.setSessionModel(sessionId, parsed.data, 'user');
    },

    modelOptions(workspaceId, sessionId) {
      getSession(workspaceId, sessionId);
      const list = listFor(sessionId);
      const current = sessionModels.get(sessionId)?.current;
      return { available: list === undefined ? null : [...list], ...(current === undefined ? {} : { current }) };
    },
  };

  return { initialModel, syncModel, onReportedModel, noteStarted, takesModelAtStart, startModelFor, ...methods };
}

export type Models = ReturnType<typeof createModels>;
