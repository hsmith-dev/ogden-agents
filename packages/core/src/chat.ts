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
 * to `Permissions`.
 *
 * The agent's own session id is stored as the adapter ref
 * `AGENT_SESSION_REF` (AD-9), never in an event. When a chat that has
 * one gets a message and has no live agent (after a restart or a crash), core
 * reopens it (story 2.7, E2-R2): the adapter resumes or loads it, else starts
 * a new session that core primes with the chat's transcript
 * (`primedPrompt`). Every reopen appends `session.resumed`. Reopening is
 * lazy, so a server start spawns no agent.
 *
 * A reopen that had to start a new session saves the new id only once its
 * primed prompt succeeded (2.7 F4), so a restart before that primes again.
 *
 * Story 2.10: a message sent while the agent answers is queued (E2-R1;
 * `session.message_queued`, at most `MAX_QUEUED_MESSAGES`) and sent,
 * first in first out, once the turn ends; a Deny reason goes first, as the
 * user's message `I denied "<command or title>": <reason>`. The agent is never
 * sent anything mid-turn. A turn that ends in `error` (or a Stop, or a close)
 * leaves the rest of the queue unsent. Reply chunks are coalesced to at most
 * one delta per `DELTA_INTERVAL_MS` per reply. A quiet agent is never
 * timed out: after `DEFAULT_CHECK_IN_MS` with no agent event while
 * `working`, core appends `session.check_in` and keeps waiting. Stop
 * ({@link Chat.cancel}) asks the agent to cancel its prompt and drops it if it
 * has not ended within `STOP_GRACE_MS`.
 *
 * Story 3.1 (CAP-5, AD-6): an `idle` chat that reached its agent can switch
 * to the agent's own CLI ({@link Chat.switchDriver}). Core releases the
 * session's agent process, waits for it to exit, and opens the CLI on the
 * same agent session in a terminal the server owns (`TerminalPort`);
 * only then is `driver` set, through the entities, which appends
 * `session.driver_changed`. Switching back kills the CLI and its tree; the
 * next message reopens the agent session as after a restart (2.7). A CLI that
 * exits by itself returns the driver to the chat. What the terminal prints or
 * is typed into it is kept in memory only (a short backlog for a viewer that
 * attaches): it is never evented, stored or logged (AD-16).
 *
 * Story 3.2 gives each refusal its own error (`SessionNotIdleError`,
 * `TerminalUnavailableError`, `DriverIsTerminalError`) and each
 * driver change its cause, and switching back first imports the turns typed
 * in the terminal (`turnsToImport`, story 3.3).
 *
 * Story 3.4: no handoff leaves a session stuck. Every driver change holds
 * the session's `switching` lock with bounded waits, a CLI that exits by
 * itself is killed with its tree and its turns imported (an error exit adds
 * the agent's note), `close` waits for the switches in flight and imports
 * the terminals' turns, and a start after a crash imports what it couldn't.
 *
 * Permission modes: each chat has a mode (Ask, Auto, Skip all) stored on
 * its session (`chat/permission-mode.ts`). Every agent session starts in it,
 * each change is told to the live agent, and a mode the agent reports that
 * the chat didn't choose moves the chat to Ask. With the event log given, the
 * chat follows it: a stored mode changed elsewhere (Developer mode turned
 * off) reaches the live agent, and a terminal handed back by Developer mode
 * is stopped.
 *
 * Epic 6: each session carries the agent it was started with (`agentId`),
 * looked up in the agent registry the server wires; a session stored before
 * agents could be chosen is the registry's legacy agent.
 *
 * The agent itself sits behind `AgentPort` (AD-1); this file names none.
 */
import { AgentError } from './agent-port.js';
import { createAgents } from './chat/agents.js';
import { createCheckIn } from './chat/check-in.js';
import { RESTARTED_REASON } from './chat/constants.js';
import { createChatContext } from './chat/context.js';
import { createModeApplier, createPermissionModes } from './chat/permission-mode.js';
import { createPermissionRequests } from './chat/permission-requests.js';
import { createReplies } from './chat/replies.js';
import { createSendNow } from './chat/send-now.js';
import { createTerminal } from './chat/terminal.js';
import { createTurns } from './chat/turns.js';
import type { Chat, ChatOptions } from './chat/types.js';
import { createWorkspaces } from './chat/workspaces.js';

export * from './chat/constants.js';
export type { Chat, ChatOptions, TerminalSize, TerminalViewer } from './chat/types.js';

export function createChat(options: ChatOptions): Chat {
  // One context per chat: its collections and `closing` are shared by reference, never copied (story 3.11).
  const ctx = createChatContext(options);
  const { entities, live, busy, running, droppedAgents, internalError } = ctx;
  // Each module gets only functions of the modules built before it.
  const { flushDelta, stopDeltaTimer, tickDelta, flushSession, finishReply } = createReplies(ctx);
  const { clearQuiet, clearTurnTimers, armQuiet } = createCheckIn(ctx, { flushDelta });
  const { onPermissionRequestFor } = createPermissionRequests(ctx, { flushSession, armQuiet });
  const applyMode = createModeApplier(ctx);
  const { drop, storedAgentSessionId, agentFor, promptFor, releaseAgent } = createAgents(ctx, { stopDeltaTimer, onPermissionRequestFor, applyMode });
  const modes = createPermissionModes(ctx, { drop, finishReply, applyMode });
  const turns = createTurns(ctx, {
    flushDelta,
    tickDelta,
    flushSession,
    finishReply,
    clearQuiet,
    clearTurnTimers,
    armQuiet,
    drop,
    agentFor,
    promptFor,
    onReportedMode: modes.onReportedMode,
  });
  const sendNow = createSendNow(ctx, { sendMessage: turns.sendMessage, stop: turns.stop, finishReply, flushSession });
  const terminal = createTerminal(ctx, { releaseAgent, storedAgentSessionId });
  const { stopTerminal, closeTerminals } = terminal;
  const workspaces = createWorkspaces(ctx, { drop, stopTerminal });
  // A stop that couldn't import the terminal's turns (a crash): they come in now (story 3.4).
  terminal.importAfterRestart();
  // Changes of a chat's stored mode made elsewhere reach its agent or its terminal (permission modes).
  // A change the agent itself caused (`agent`) is told by `onReportedMode` only when it must be.
  const unfollow = options.events?.subscribe(options.events.lastSeq(), (event) => {
    if (ctx.closing) return;
    if (event.type === 'session.permission_mode_changed' && event.payload.cause !== 'agent') modes.followStoredMode(event.payload.sessionId);
    else if (event.type === 'session.driver_changed' && event.payload.cause === 'developer_mode_off') terminal.releaseTerminal(event.payload.sessionId);
  });

  // Every session the chat answers names its agent (epic 6): one stored before agents could be chosen reads as the legacy agent.
  const { withAgentId } = ctx;

  return {
    openWorkspace: workspaces.openWorkspace,
    listWorkspaces: workspaces.listWorkspaces,
    getWorkspace: workspaces.getWorkspace,
    listSessions: (workspaceId) => workspaces.listSessions(workspaceId).map(withAgentId),
    deleteHistory: workspaces.deleteHistory,
    createChatSession: async (workspaceId, options) => withAgentId(await workspaces.createChatSession(workspaceId, options)),
    chatAgents: workspaces.chatAgents,
    getSession: (workspaceId, sessionId) => withAgentId(workspaces.getSession(workspaceId, sessionId)),
    sendMessage: sendNow.sendMessage,
    updateQueuedMessage: sendNow.updateQueuedMessage,
    removeQueuedMessage: sendNow.removeQueuedMessage,
    sendQueuedMessageNow: sendNow.sendQueuedMessageNow,
    cancel: turns.cancel,
    switchDriver: async (workspaceId, sessionId, driver) => withAgentId(await terminal.switchDriver(workspaceId, sessionId, driver)),
    attachTerminal: terminal.attachTerminal,
    setPermissionMode: (workspaceId, sessionId, mode, options) => withAgentId(modes.setPermissionMode(workspaceId, sessionId, mode, options)),
    permissionModeOptions: modes.permissionModeOptions,

    async settled() {
      while (running.size > 0) await Promise.all([...running]);
    },

    async close() {
      if (!ctx.closing) {
        // Before the agents stop, so their exits don't read as crashes.
        for (const sessionId of new Set([...busy.keys(), ...live.keys()])) {
          try {
            const state = entities.getSession(sessionId)?.state;
            if (state === 'working' || state === 'waiting') {
              const entry = live.get(sessionId);
              if (entry !== undefined) finishReply(sessionId, entry);
              entities.setSessionState(sessionId, 'idle', { reason: RESTARTED_REASON, resumable: true });
            }
          } catch (error) {
            internalError(sessionId, error);
          }
        }
      }
      ctx.closing = true;
      unfollow?.();
      // The server owns the terminals (AD-3): once the switches in flight end (bounded), they stop
      // with it, their turns are imported and their chats drive again (story 3.4).
      const stoppingTerminals = closeTerminals();
      // Queued messages are not sent: the `idle` above marks them "Not sent".
      for (const turn of busy.values()) {
        clearTurnTimers(turn);
        turn.queue = [];
        turn.reasons = [];
      }
      const entries = [...live.entries()];
      live.clear();
      await Promise.all(
        entries.map(async ([sessionId, entry]) => {
          stopDeltaTimer(entry);
          entry.off?.();
          entry.markGone();
          try {
            await (await entry.agent).close();
          } catch (error) {
            if (!(error instanceof AgentError)) internalError(sessionId, error);
          }
        }),
      );
      // And the agents dropped before (a failure, an expired sign-in, a Stop past its grace).
      while (droppedAgents.size > 0) await Promise.all([...droppedAgents.values()]);
      await stoppingTerminals;
    },
  };
}
