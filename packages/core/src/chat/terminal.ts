/**
 * The agent's own terminal (story 3.1, AD-6), moved from `chat.ts` (story
 * 3.11): switching a session's driver, and a viewer's hold on its terminal.
 * What the terminal prints or is typed into it is never logged, evented or
 * stored (AD-16).
 */
import type { Session, SessionId } from '@ogden-agents/shared';
import { AgentError, type AgentTerminalResume, type AgentTranscriptTurn } from '../agent-port.js';
import { InvalidOperationError, SessionNotIdleError, TerminalImportError, TerminalUnavailableError } from '../errors.js';
import { omittedNote, START_MARK, turnsToImport } from '../terminal-import.js';
import type { TerminalProcess } from '../terminal-port.js';
import type { Agents } from './agents.js';
import { TERMINAL_BACKLOG_CHARS, TERMINAL_COLS, TERMINAL_EXIT_GRACE_MS, TERMINAL_IMPORT_REF, TERMINAL_ROWS } from './constants.js';
import type { ChatContext } from './context.js';
import type { Chat, Terminal, Timer } from './types.js';

export function createTerminal(ctx: ChatContext, deps: Pick<Agents, 'releaseAgent' | 'storedAgentSessionId'>) {
  const { options, entities, sessionEvents, agent, agentEnv, busy, terminals, switching, internalError, later, newMessageId, getWorkspace, getSession } = ctx;
  const { releaseAgent, storedAgentSessionId } = deps;

  /** Keeps the newest {@link TERMINAL_BACKLOG_CHARS} of output, starting at a line where it can. */
  const trimBacklog = (text: string): string => {
    if (text.length <= TERMINAL_BACKLOG_CHARS) return text;
    const cut = text.slice(-TERMINAL_BACKLOG_CHARS);
    const line = cut.indexOf('\n');
    return line === -1 ? cut : cut.slice(line + 1);
  };

  /** Tells the terminal's viewers it has ended, once. */
  const endTerminal = (sessionId: SessionId, terminal: Terminal, exitCode: number | null) => {
    if (terminal.ended) return;
    terminal.ended = true;
    for (const listener of [...terminal.end]) {
      try {
        listener({ exitCode });
      } catch (error) {
        internalError(sessionId, error);
      }
    }
    terminal.end.clear();
    terminal.data.clear();
  };

  /** Kills the session's terminal, if any, and waits (bounded) for it to exit. The driver is the caller's to set. */
  const stopTerminal = async (sessionId: SessionId): Promise<void> => {
    const terminal = terminals.get(sessionId);
    if (terminal === undefined) return;
    terminals.delete(sessionId);
    try {
      terminal.process.kill();
    } catch (error) {
      internalError(sessionId, error);
    }
    endTerminal(sessionId, terminal, null);
    let timer: Timer | undefined;
    await Promise.race([terminal.exited, new Promise<void>((resolve) => (timer = later(TERMINAL_EXIT_GRACE_MS, resolve)))]);
    clearTimeout(timer);
  };

  /** The CLI's record of the session's agent session (story 3.3), `undefined` when the agent can't read it back; rejects as the adapter's `transcript` does. */
  const readTranscript = async (session: Session, agentSessionId: string): Promise<AgentTranscriptTurn[] | undefined> => {
    const resume = agent.terminalResume;
    if (resume?.transcript === undefined) return undefined;
    const workspace = getWorkspace(session.workspaceId);
    return resume.transcript({ agentSessionId, cwd: workspace.realPath ?? workspace.path, env: { ...agentEnv() } });
  };

  /**
   * Saves where the CLI's record stands as the terminal opens (story 3.3): its
   * last turn's id, or {@link START_MARK} when it has none. A failed read
   * saves no mark (the switch back then lines up on the chat's last message)
   * and is logged as a code; the terminal opens either way.
   */
  const markTerminalImport = async (session: Session, agentSessionId: string): Promise<void> => {
    if (agent.terminalResume?.transcript === undefined) return;
    let mark = '';
    try {
      mark = (await readTranscript(session, agentSessionId))?.at(-1)?.id ?? START_MARK;
    } catch (error) {
      internalError(session.id, new TerminalImportError('terminal_import_unreadable', error));
    }
    try {
      entities.setSessionAdapterRefs(session.id, { [TERMINAL_IMPORT_REF]: mark });
    } catch (error) {
      internalError(session.id, new TerminalImportError('terminal_import_failed', error));
    }
  };

  const toTerminal = async (session: Session): Promise<Session> => {
    const terminal = options.terminal;
    const resume = agent.terminalResume;
    if (resume === undefined) {
      throw new TerminalUnavailableError('agent_unsupported', `${agent.displayName} can't be opened in its own terminal.`);
    }
    if (terminal === undefined) throw new TerminalUnavailableError('pty_unavailable', "The terminal can't start on this computer.");
    if (busy.has(session.id) || session.state !== 'idle') {
      throw new SessionNotIdleError(`${agent.displayName} is busy. Switch to the terminal when it is idle.`);
    }
    const agentSessionId = storedAgentSessionId(session.id);
    if (agentSessionId === undefined) {
      throw new TerminalUnavailableError('no_agent_session', `Send ${agent.displayName} a message first, then switch to the terminal.`);
    }
    const workspace = getWorkspace(session.workspaceId);
    const availability = await terminal.available();
    if (!availability.ok) throw new TerminalUnavailableError('pty_unavailable', `The terminal can't start on this computer: ${availability.reason}`);
    const env = { ...agentEnv() };
    const located = await resume.locate(env);
    if (!located.found) throw new TerminalUnavailableError('cli_not_found', located.reason);
    let command: Awaited<ReturnType<AgentTerminalResume['command']>>;
    try {
      command = await resume.command(agentSessionId, env);
    } catch (error) {
      throw new TerminalUnavailableError('cli_not_found', error instanceof AgentError ? error.message : `${agent.displayName}'s terminal couldn't be found.`);
    }
    if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
    await releaseAgent(session.id);
    // The agent has stopped: its record is complete, so what the terminal adds comes after the mark.
    await markTerminalImport(session, agentSessionId);
    if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
    let cli: TerminalProcess;
    try {
      cli = await terminal.open({
        file: command.file,
        args: command.args,
        // The real-cased path, as the agent had it: the CLI finds its sessions by folder.
        cwd: workspace.realPath ?? workspace.path,
        env: { ...command.env, TERM: 'xterm-256color' },
        cols: TERMINAL_COLS,
        rows: TERMINAL_ROWS,
      });
    } catch (error) {
      internalError(session.id, error);
      throw new TerminalUnavailableError('pty_unavailable', `${agent.displayName}'s terminal couldn't start. Try again.`);
    }
    let markExited!: () => void;
    const entry: Terminal = {
      process: cli,
      backlog: '',
      data: new Set(),
      end: new Set(),
      ended: false,
      exited: new Promise<void>((resolve) => (markExited = resolve)),
    };
    terminals.set(session.id, entry);
    cli.onData((data) => {
      entry.backlog = trimBacklog(entry.backlog + data);
      for (const listener of [...entry.data]) {
        try {
          listener(data);
        } catch (error) {
          internalError(session.id, error);
        }
      }
    });
    cli.onExit(({ exitCode }) => {
      markExited();
      // Switched back (or closed) already: the driver is set there.
      if (terminals.get(session.id) !== entry) return;
      terminals.delete(session.id);
      endTerminal(session.id, entry, exitCode);
      if (ctx.closing) return;
      try {
        // The CLI exited by itself (`/exit`, a crash): the chat drives again.
        entities.setSessionDriver(session.id, 'ui', 'cli_exited');
      } catch (error) {
        internalError(session.id, error);
      }
    });
    if (ctx.closing) {
      await stopTerminal(session.id);
      throw new InvalidOperationError('Ogden Agents is stopping.');
    }
    try {
      return entities.setSessionDriver(session.id, 'terminal', 'user');
    } catch (error) {
      await stopTerminal(session.id);
      throw error;
    }
  };

  /**
   * Appends the turns typed in the terminal that the chat lacks (E3-R4, story
   * 3.3): those after the mark saved when it opened, the user's marked
   * `origin: 'terminal'`, then moves the mark to the CLI's last turn so
   * nothing is imported twice. Any failure is logged as a code and imports
   * nothing more: the switch back still completes.
   */
  const importTerminalTurns = async (session: Session): Promise<void> => {
    const agentSessionId = storedAgentSessionId(session.id);
    if (agentSessionId === undefined) return;
    let turns: AgentTranscriptTurn[] | undefined;
    try {
      turns = await readTranscript(session, agentSessionId);
    } catch (error) {
      internalError(session.id, new TerminalImportError('terminal_import_unreadable', error));
      return;
    }
    if (turns === undefined) return;
    try {
      const mark = entities.getSession(session.id)?.adapterRefs[TERMINAL_IMPORT_REF];
      const plan = turnsToImport(entities.listCompletedMessages(session.id), turns, mark);
      if (plan.unaligned) internalError(session.id, new TerminalImportError('terminal_import_unaligned'));
      if (plan.omitted > 0) {
        sessionEvents.completeMessage(session.id, { messageId: newMessageId(), role: 'agent', content: omittedNote(plan.omitted) });
      }
      for (const turn of plan.turns) {
        sessionEvents.completeMessage(session.id, {
          messageId: newMessageId(),
          role: turn.role,
          content: turn.text,
          ...(turn.role === 'user' ? { origin: 'terminal' as const } : {}),
        });
      }
      entities.setSessionAdapterRefs(session.id, { [TERMINAL_IMPORT_REF]: turns.at(-1)?.id ?? START_MARK });
    } catch (error) {
      internalError(session.id, new TerminalImportError('terminal_import_failed', error));
    }
  };

  const toChat = async (session: Session): Promise<Session> => {
    await stopTerminal(session.id);
    await importTerminalTurns(session);
    return entities.setSessionDriver(session.id, 'ui', 'user');
  };

  const methods: Pick<Chat, 'switchDriver' | 'attachTerminal'> = {
    async switchDriver(workspaceId, sessionId, driver) {
      if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
      const session = getSession(workspaceId, sessionId);
      if (switching.has(sessionId)) throw new SessionNotIdleError('This chat is already switching. Try again in a moment.');
      if (session.driver === driver) return session;
      switching.add(sessionId);
      try {
        return driver === 'terminal' ? await toTerminal(session) : await toChat(session);
      } finally {
        switching.delete(sessionId);
      }
    },

    attachTerminal(sessionId) {
      const terminal = terminals.get(sessionId);
      if (terminal === undefined || terminal.ended) return undefined;
      return {
        backlog: terminal.backlog,
        onData(listener) {
          terminal.data.add(listener);
          return () => void terminal.data.delete(listener);
        },
        onEnd(listener) {
          terminal.end.add(listener);
          return () => void terminal.end.delete(listener);
        },
        write: (data) => terminal.process.write(data),
        resize: (cols, rows) => terminal.process.resize(cols, rows),
      };
    },
  };

  return { trimBacklog, endTerminal, stopTerminal, toTerminal, importTerminalTurns, toChat, ...methods };
}
