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
 * to {@link Permissions}.
 *
 * The agent's own session id is stored as the adapter ref
 * {@link AGENT_SESSION_REF} (AD-9), never in an event. When a chat that has
 * one gets a message and has no live agent (after a restart or a crash), core
 * reopens it (story 2.7, E2-R2): the adapter resumes or loads it, else starts
 * a new session that core primes with the chat's transcript
 * ({@link primedPrompt}). Every reopen appends `session.resumed`. Reopening is
 * lazy, so a server start spawns no agent.
 *
 * A reopen that had to start a new session saves the new id only once its
 * primed prompt succeeded (2.7 F4), so a restart before that primes again.
 *
 * Story 2.10: a message sent while the agent answers is queued (E2-R1;
 * `session.message_queued`, at most {@link MAX_QUEUED_MESSAGES}) and sent,
 * first in first out, once the turn ends; a Deny reason goes first, as the
 * user's message `I denied "<command or title>": <reason>`. The agent is never
 * sent anything mid-turn. A turn that ends in `error` (or a Stop, or a close)
 * leaves the rest of the queue unsent. Reply chunks are coalesced to at most
 * one delta per {@link DELTA_INTERVAL_MS} per reply. A quiet agent is never
 * timed out: after {@link DEFAULT_CHECK_IN_MS} with no agent event while
 * `working`, core appends `session.check_in` and keeps waiting. Stop
 * ({@link Chat.cancel}) asks the agent to cancel its prompt and drops it if it
 * has not ended within {@link STOP_GRACE_MS}.
 *
 * Story 3.1 (CAP-5, AD-6): an `idle` chat that reached its agent can switch
 * to the agent's own CLI ({@link Chat.switchDriver}). Core releases the
 * session's agent process, waits for it to exit, and opens the CLI on the
 * same agent session in a terminal the server owns ({@link TerminalPort});
 * only then is `driver` set, through the entities, which appends
 * `session.driver_changed`. Switching back kills the CLI and its tree; the
 * next message reopens the agent session as after a restart (2.7). A CLI that
 * exits by itself returns the driver to the chat. What the terminal prints or
 * is typed into it is kept in memory only (a short backlog for a viewer that
 * attaches): it is never evented, stored or logged (AD-16).
 *
 * Story 3.2 gives each refusal its own error ({@link SessionNotIdleError},
 * {@link TerminalUnavailableError}, {@link DriverIsTerminalError}) and each
 * driver change its cause, and switching back first imports the turns typed
 * in the terminal ({@link turnsToImport}, story 3.3).
 *
 * Story 3.4: no handoff leaves a session stuck. Every driver change holds
 * the session's `switching` lock with bounded waits, a CLI that exits by
 * itself is killed with its tree and its turns imported (an error exit adds
 * the agent's note), `close` waits for the switches in flight and imports
 * the terminals' turns, and a start after a crash imports what it couldn't.
 *
 * The agent itself sits behind {@link AgentPort} (AD-1); this file names none.
 */
import { AgentError } from './agent-port.js';
import { createAgents } from './chat/agents.js';
import { createCheckIn } from './chat/check-in.js';
import { RESTARTED_REASON } from './chat/constants.js';
import { createChatContext } from './chat/context.js';
import { createPermissionRequests } from './chat/permission-requests.js';
import { createReplies } from './chat/replies.js';
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
  const { drop, storedAgentSessionId, agentFor, promptFor, releaseAgent } = createAgents(ctx, { stopDeltaTimer, onPermissionRequestFor });
  const turns = createTurns(ctx, { flushDelta, tickDelta, flushSession, finishReply, clearQuiet, clearTurnTimers, armQuiet, drop, agentFor, promptFor });
  const terminal = createTerminal(ctx, { releaseAgent, storedAgentSessionId });
  const { stopTerminal, closeTerminals } = terminal;
  const workspaces = createWorkspaces(ctx, { drop, stopTerminal });
  // A stop that couldn't import the terminal's turns (a crash): they come in now (story 3.4).
  terminal.importAfterRestart();

  return {
    openWorkspace: workspaces.openWorkspace,
    listWorkspaces: workspaces.listWorkspaces,
    getWorkspace: workspaces.getWorkspace,
    listSessions: workspaces.listSessions,
    deleteHistory: workspaces.deleteHistory,
    createChatSession: workspaces.createChatSession,
    getSession: workspaces.getSession,
    sendMessage: turns.sendMessage,
    cancel: turns.cancel,
    switchDriver: terminal.switchDriver,
    attachTerminal: terminal.attachTerminal,

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
              for (const entry of [live.get(sessionId)]) if (entry !== undefined) finishReply(sessionId, entry);
              entities.setSessionState(sessionId, 'idle', { reason: RESTARTED_REASON, resumable: true });
            }
          } catch (error) {
            internalError(sessionId, error);
          }
        }
      }
      ctx.closing = true;
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
