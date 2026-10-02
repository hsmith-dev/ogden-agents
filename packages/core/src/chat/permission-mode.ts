/**
 * A chat's permission mode (permission modes): `ask`, `auto` or `skip_all`,
 * stored on the session and changed only by core, each change a
 * `session.permission_mode_changed` event.
 *
 * - Every agent session is put in the chat's stored mode when it starts or
 *   reopens, before it takes a prompt, whatever the agent's own settings
 *   say ({@link createModeApplier}); a new chat, and every chat after a
 *   server start, is in Ask.
 * - Each later change of the stored mode is told to the chat's live agent,
 *   one at a time (`followStoredMode`). An agent that can't be told within a
 *   bounded wait is dropped (its process stopped): never left asking less
 *   than the chat says. One that can't take a looser mode moves the chat
 *   back to Ask (cause `agent`).
 * - A mode the agent reports that the chat didn't choose moves the chat to
 *   Ask (cause `agent`), and the agent is told Ask when that mode asks less
 *   than Ask (`onReportedMode`).
 * - The user's choice (`setPermissionMode`) is checked here, in the server's
 *   process: Skip all only with Developer mode on and the user's
 *   confirmation, only a mode the agent and its session offer, never while
 *   the terminal drives.
 */
import { PERMISSION_MODE_LABELS, PERMISSION_MODES, PermissionMode as PermissionModeSchema, type PermissionMode, type SessionId, type SessionPermissionModeOption } from '@ogden-agents/shared';
import type { AgentEvent, AgentSession } from '../agent-port.js';
import {
  ConfirmationRequiredError,
  CoreError,
  DeveloperModeRequiredError,
  DriverIsTerminalError,
  InvalidOperationError,
  ModeUnavailableError,
  SessionNotIdleError,
  ValidationError,
} from '../errors.js';
import type { Agents } from './agents.js';
import type { ChatContext } from './context.js';
import type { Replies } from './replies.js';
import type { Chat, Live, Timer } from './types.js';

/** A permission mode an agent couldn't take or confirm in time: a code, for the log only. */
export class PermissionModeError extends CoreError {
  override readonly name = 'PermissionModeError';
  constructor(code: 'permission_mode_timeout' | 'permission_mode_refused' | 'permission_mode_unoffered', readonly mode: PermissionMode) {
    super(code, `${code} (${mode})`);
  }
}

/** The modes an agent session offers (Ask only when it says nothing). */
const offeredBy = (session: Pick<AgentSession, 'permissionModes'>): readonly PermissionMode[] => session.permissionModes ?? ['ask'];

/**
 * Puts a started agent session in the chat's stored mode (read when it is
 * applied), within `ctx.permissionModeTimeoutMs`. A looser mode it can't
 * take (not offered, refused, too slow) moves the chat to Ask (cause
 * `agent`) and is tried again as Ask; one that doesn't answer in time is
 * never tried again (it may still take it). Resolves `true` once the agent runs in
 * the chat's stored mode, `false` when it couldn't be put even in Ask: the
 * caller then stops it. Never rejects.
 */
export function createModeApplier(ctx: ChatContext) {
  const { entities, agent, internalError, later } = ctx;

  /** How `promise` settled within the bound: `ok`, `refused`, or `timeout` (the last two logged as a code). */
  const told = async (sessionId: SessionId, mode: PermissionMode, promise: Promise<void>): Promise<'ok' | 'refused' | 'timeout'> => {
    let timer: Timer | undefined;
    try {
      const result = await Promise.race([
        promise.then(
          () => 'ok' as const,
          () => 'refused' as const,
        ),
        new Promise<'timeout'>((resolve) => (timer = later(ctx.permissionModeTimeoutMs, () => resolve('timeout')))),
      ]);
      if (result !== 'ok') internalError(sessionId, new PermissionModeError(result === 'timeout' ? 'permission_mode_timeout' : 'permission_mode_refused', mode));
      return result;
    } finally {
      clearTimeout(timer);
    }
  };

  return async (sessionId: SessionId, started: AgentSession): Promise<boolean> => {
    // At most twice: the stored mode, then Ask.
    for (let attempt = 0; attempt < 2; attempt++) {
      const mode = entities.getSession(sessionId)?.permissionMode ?? 'ask';
      let ok: boolean;
      if (!offeredBy(started).includes(mode)) {
        internalError(sessionId, new PermissionModeError('permission_mode_unoffered', mode));
        ok = false;
      } else if (started.setPermissionMode === undefined) {
        // An agent that takes no mode only ever runs in Ask.
        ok = mode === 'ask';
      } else {
        const result = await told(sessionId, mode, Promise.resolve().then(() => started.setPermissionMode!(mode)));
        // Too slow: the agent may still take that mode later, so it is never trusted again (the caller stops it).
        if (result === 'timeout') return false;
        ok = result === 'ok';
      }
      if (ok) return true;
      if (mode === 'ask') return false;
      try {
        // Only if the chat still says that mode: a newer choice is applied in its own turn.
        if (entities.getSession(sessionId)?.permissionMode === mode) {
          entities.setSessionPermissionMode(sessionId, 'ask', 'agent', `${agent.displayName} couldn't switch to ${PERMISSION_MODE_LABELS[mode]}, so this chat is back in Ask.`);
        }
      } catch (error) {
        internalError(sessionId, error);
        return false;
      }
    }
    return false;
  };
}

export type ModeApplier = ReturnType<typeof createModeApplier>;

export function createPermissionModes(ctx: ChatContext, deps: Pick<Agents, 'drop'> & Pick<Replies, 'finishReply'> & { applyMode: ModeApplier }) {
  const { entities, agent, live, switching, internalError, getSession, sessionModes } = ctx;
  const { drop, finishReply, applyMode } = deps;

  /** The agent couldn't be told the chat's mode, not even Ask: it is stopped, and the chat can be resumed. */
  const dropForMode = (sessionId: SessionId, entry: Live) => {
    if (live.get(sessionId) !== entry || ctx.closing) return;
    try {
      finishReply(sessionId, entry);
    } catch (error) {
      internalError(sessionId, error);
    }
    drop(sessionId, entry);
    try {
      const state = entities.getSession(sessionId)?.state;
      if (state === 'working' || state === 'waiting') {
        entities.setSessionState(sessionId, 'idle', {
          reason: `${agent.displayName} was stopped because it couldn't switch to this chat's permission mode. Send your message again to restart it.`,
          resumable: true,
        });
      }
    } catch (error) {
      internalError(sessionId, error);
    }
  };

  /**
   * Tells the session's live agent its stored mode (read when it is told),
   * after any change already being told; drops it if it can't be put even in
   * Ask. Nothing to do without a live agent: the next one starts in the mode.
   */
  const followStoredMode = (sessionId: SessionId, retry = true): void => {
    const entry = live.get(sessionId);
    if (entry === undefined || ctx.closing) return;
    // Each link catches its own failure, so the chain always resolves and a later change is always told.
    entry.modeSync = entry.modeSync.then(async () => {
      try {
        let started: AgentSession;
        try {
          started = await entry.agent;
        } catch {
          // It never started: the next one starts in the mode.
          return;
        }
        if (live.get(sessionId) !== entry || ctx.closing) return;
        if (!(await applyMode(sessionId, started))) dropForMode(sessionId, entry);
      } catch (error) {
        internalError(sessionId, error);
        // Its mode is not known: told once more, after this link; a second failure stops it.
        if (retry) followStoredMode(sessionId, false);
        else dropForMode(sessionId, entry);
      }
    });
  };

  /**
   * The agent reports a mode (AD-4 events): its echo of the chat's own mode
   * changes nothing; any other moves the chat to Ask (cause `agent`), and the
   * agent is told Ask when that mode asks less than Ask.
   */
  const onReportedMode = (sessionId: SessionId, event: Extract<AgentEvent, { type: 'permission_mode' }>): void => {
    const session = entities.getSession(sessionId);
    if (session === undefined || event.mode === session.permissionMode) return;
    if (session.permissionMode !== 'ask') {
      const label = event.label ?? (event.mode === 'other' ? 'another mode' : PERMISSION_MODE_LABELS[event.mode]);
      entities.setSessionPermissionMode(sessionId, 'ask', 'agent', `${agent.displayName} switched itself to ${label}, so this chat is back in Ask.`);
    }
    if (event.asksLess) followStoredMode(sessionId);
  };

  /** Plain words for a mode the agent, or its session, doesn't offer; `undefined` when it does. */
  const unavailableReason = (sessionId: SessionId, mode: PermissionMode): string | undefined => {
    // Ask is every agent's: it is where every chat starts.
    if (mode === 'ask') return undefined;
    const label = PERMISSION_MODE_LABELS[mode];
    if (!(agent.permissionModes ?? ['ask']).includes(mode)) return `${agent.displayName} doesn't offer ${label}.`;
    // This chat's agent session when it started this run, else the one that started last in this run (any chat).
    const listed = sessionModes.get(sessionId) ?? ctx.lastSessionModes.value;
    if (listed !== undefined && !listed.includes(mode)) return `This chat's ${agent.displayName} session doesn't offer ${label} on this computer.`;
    return undefined;
  };

  const methods: Pick<Chat, 'setPermissionMode' | 'permissionModeOptions'> = {
    setPermissionMode(workspaceId, sessionId, mode, options = {}) {
      if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
      const session = getSession(workspaceId, sessionId);
      const parsed = PermissionModeSchema.safeParse(mode);
      if (!parsed.success) throw new ValidationError('Choose Ask, Auto or Skip all.', [{ path: ['mode'], message: 'unknown mode' }]);
      if (session.driver === 'terminal') throw new DriverIsTerminalError('The terminal is driving this chat. Switch back to the chat to change its permission mode.');
      if (switching.has(sessionId)) throw new SessionNotIdleError('This chat is switching to or from the terminal. Try again in a moment.');
      if (session.permissionMode === parsed.data) return session;
      if (parsed.data === 'skip_all') {
        // The server is the gate (not the agent's start options): Developer mode, then the user's confirmation.
        if (!ctx.developerMode()) throw new DeveloperModeRequiredError();
        if (options.confirm !== true) throw new ConfirmationRequiredError();
      }
      const unavailable = unavailableReason(sessionId, parsed.data);
      if (unavailable !== undefined) throw new ModeUnavailableError(unavailable);
      const updated = entities.setSessionPermissionMode(sessionId, parsed.data, 'user');
      // Told now when nothing follows the log for this chat (with it, the log's own delivery tells it too: the same mode twice is a no-op).
      if (ctx.options.events === undefined) followStoredMode(sessionId);
      return updated;
    },

    permissionModeOptions(workspaceId, sessionId) {
      getSession(workspaceId, sessionId);
      return PERMISSION_MODES.map((mode): SessionPermissionModeOption => {
        const reason = unavailableReason(sessionId, mode);
        return reason === undefined ? { mode, available: true } : { mode, available: false, reason };
      });
    },
  };

  return { followStoredMode, onReportedMode, ...methods };
}

export type PermissionModes = ReturnType<typeof createPermissionModes>;
