/**
 * The agent's own terminal (story 3.1, AD-6), moved from `chat.ts` (story
 * 3.11): switching a session's driver, and a viewer's hold on its terminal.
 * What the terminal prints or is typed into it is never logged, evented or
 * stored (AD-16).
 *
 * Story 3.4 (E3-R5): every driver change (a switch either way, a CLI that
 * exits by itself, a close, the import after a crash) holds the session's
 * `switching` lock, so no message is taken and no other switch starts, and
 * each one's wait is bounded. Each ends at `driver = ui` (idle, resumable)
 * or at `driver = terminal` with a live CLI, and every path that ends a CLI
 * kills its whole tree, even once the CLI itself has exited.
 *
 * Story 3.5: a terminal has several viewers, each with its own size; the
 * terminal takes the size of whichever viewer last resized or typed, and the
 * others are told. A viewer that detaches leaves the terminal running, with or
 * without viewers, until it is switched back or the server stops.
 */
import { MAX_TERMINAL_COLS, MAX_TERMINAL_ROWS, PERMISSION_MODE_RANK, type Session, type SessionId } from '@ogden-agents/shared';
import { AgentError, type AgentTerminalResume, type AgentTranscriptTurn } from '../agent-port.js';
import { InvalidOperationError, SessionNotIdleError, TerminalHandoffError, TerminalImportError, TerminalUnavailableError } from '../errors.js';
import { PROTECTED_PATHS } from '../permission-matching.js';
import { omittedNote, START_MARK, turnsToImport } from '../terminal-import.js';
import type { TerminalProcess } from '../terminal-port.js';
import { checkTerminalReady, checkTerminalSupport } from '../terminal-checks.js';
import { terminalUnavailableReason } from '../terminal-reasons.js';
import type { Agents } from './agents.js';
import {
  TERMINAL_CLOSE_WAIT_MS,
  TERMINAL_COLS,
  TERMINAL_EXIT_GRACE_MS,
  TERMINAL_IMPORT_PENDING_REF,
  TERMINAL_IMPORT_REF,
  TERMINAL_RELEASE_TIMEOUT_MS,
  TERMINAL_ROWS,
  TERMINAL_STEP_TIMEOUT_MS,
  terminalClosedNote,
} from './constants.js';
import type { ChatContext } from './context.js';
import { trimBacklog } from './terminal-backlog.js';
import type { Chat, Terminal, TerminalSize, TerminalViewerEntry, Timer } from './types.js';

// The backlog trim lives beside this module (story 6.9); its tests import it from here.
export { trimBacklog };

export function createTerminal(ctx: ChatContext, deps: Pick<Agents, 'releaseAgent' | 'storedAgentSessionId'>) {
  const { options, entities, sessionEvents, agentOf, agentEnv, busy, running, terminals, switching, internalError, later, newMessageId, getWorkspace, getSession } = ctx;
  const { releaseAgent, storedAgentSessionId } = deps;

  /** The driver changes in flight (each holding its session's `switching`): `close` waits for them. */
  const switches = new Set<Promise<void>>();
  /** Sessions whose terminal is to stop once the switch holding them ends (Developer mode turned off meanwhile). */
  const releaseAfterSwitch = new Set<SessionId>();

  /** Whether `promise` settled within `ms` (its rejection counts as settled). */
  const within = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
    let timer: Timer | undefined;
    try {
      return await Promise.race([
        promise.then(
          () => true,
          () => true,
        ),
        new Promise<false>((resolve) => (timer = later(ms, () => resolve(false)))),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const TIMED_OUT = Symbol('timed out');

  /**
   * One bound shared by several steps (story 3.4 review F1): `step` settles as
   * its promise does, or as {@link TIMED_OUT} once `ms` have passed since the
   * deadline started. `clear` stops its timer.
   */
  const startDeadline = (ms: number) => {
    let timer: Timer | undefined;
    const expired = new Promise<typeof TIMED_OUT>((resolve) => (timer = later(ms, () => resolve(TIMED_OUT))));
    return {
      step: <T>(promise: Promise<T>): Promise<T | typeof TIMED_OUT> => Promise.race([promise, expired]),
      clear: () => clearTimeout(timer),
    };
  };

  /** `promise`'s value, or {@link TIMED_OUT} after `ms`; a late rejection is swallowed. */
  const bounded = async <T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> => {
    const deadline = startDeadline(ms);
    try {
      const result = await deadline.step(promise);
      if (result === TIMED_OUT) promise.catch(() => undefined);
      return result;
    } finally {
      deadline.clear();
    }
  };

  /**
   * Runs `work` holding the session's `switching` lock, taken before this
   * returns and released when `work` ends however it ends. Tracked, so
   * `settled` and `close` wait for it.
   */
  const holdingSwitch = <T>(sessionId: SessionId, work: () => Promise<T>): Promise<T> => {
    switching.add(sessionId);
    const done = (async () => {
      try {
        return await work();
      } finally {
        switching.delete(sessionId);
        if (releaseAfterSwitch.delete(sessionId)) releaseTerminal(sessionId);
      }
    })();
    const tracked = done.then(
      () => undefined,
      () => undefined,
    );
    switches.add(tracked);
    running.add(tracked);
    void tracked.then(() => {
      switches.delete(tracked);
      running.delete(tracked);
    });
    return done;
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
    // A CLI that ignores the kill doesn't hold the switch: it goes on, with a code in the log.
    if (!(await within(terminal.exited, TERMINAL_EXIT_GRACE_MS))) internalError(sessionId, new TerminalHandoffError('terminal_exit_timeout'));
  };

  /** The CLI's record of the session's agent session (story 3.3), `undefined` when the agent can't read it back; rejects as the adapter's `transcript` does. */
  const readTranscript = async (session: Session, agentSessionId: string): Promise<AgentTranscriptTurn[] | undefined> => {
    const resume = agentOf(session.id).terminalResume;
    if (resume?.transcript === undefined) return undefined;
    const workspace = getWorkspace(session.workspaceId);
    // Bounded (review F1): a read that hangs is an unreadable record; the switch goes on.
    const read = await bounded(resume.transcript({ agentSessionId, cwd: workspace.realPath ?? workspace.path, env: { ...agentEnv(session.id) } }), TERMINAL_STEP_TIMEOUT_MS);
    if (read === TIMED_OUT) throw new TerminalHandoffError('terminal_read_timeout');
    return read;
  };

  /**
   * Saves where the CLI's record stands as the terminal opens (story 3.3): its
   * last turn's id, or {@link START_MARK} when it has none. A failed read
   * saves no mark (the switch back then lines up on the chat's last message)
   * and is logged as a code; the terminal opens either way.
   */
  const markTerminalImport = async (session: Session, agentSessionId: string): Promise<void> => {
    if (agentOf(session.id).terminalResume?.transcript === undefined) return;
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
    // The session's own agent (epic 6): its CLI, its name.
    const agent = agentOf(session.id);
    // The checks are shared with the server's availability check (story 3.9), the idle check between their stages.
    const support = checkTerminalSupport(agent, options.terminal);
    if ('available' in support) throw new TerminalUnavailableError(support.code, support.reason);
    const { resume, terminal } = support;
    if (busy.has(session.id) || session.state !== 'idle') {
      throw new SessionNotIdleError(`${agent.displayName} is busy. Switch to the terminal when it is idle.`);
    }
    /** Opening took too long: a code in the log, plain words to the user. */
    const tooSlow = () => {
      internalError(session.id, new TerminalHandoffError('terminal_open_timeout'));
      return new TerminalUnavailableError('pty_unavailable', terminalUnavailableReason.tooSlow(agent.displayName));
    };
    // The checks before the agent is released share one deadline (review F1): none can hold the lock.
    const env = { ...agentEnv(session.id) };
    const deadline = startDeadline(TERMINAL_STEP_TIMEOUT_MS);
    const step = async <T>(promise: Promise<T>): Promise<T> => {
      const result = await deadline.step(promise);
      if (result === TIMED_OUT) throw tooSlow();
      return result;
    };
    let agentSessionId: string;
    let command: Awaited<ReturnType<AgentTerminalResume['command']>>;
    // The CLI starts in the chat's permission mode (permission modes): asking, auto, or skipping its checks.
    const permissionMode = entities.getSession(session.id)?.permissionMode ?? 'ask';
    // The CLI starts on the chat's model (story 11).
    const model = entities.getSession(session.id)?.model ?? null;
    try {
      const sessionId = storedAgentSessionId(session.id);
      const unavailable = await checkTerminalReady({ agent, support, agentSessionId: sessionId, env: () => env, step });
      if (unavailable !== undefined) throw new TerminalUnavailableError(unavailable.code, unavailable.reason);
      agentSessionId = sessionId!;
      let built: typeof command | typeof TIMED_OUT;
      try {
        built = await deadline.step(resume.command(agentSessionId, env, {
            permissionMode,
            ...(permissionMode === 'auto' ? { protectedPaths: PROTECTED_PATHS } : {}),
            ...(model === null ? {} : { model }),
          }));
      } catch (error) {
        throw new TerminalUnavailableError('cli_not_found', terminalUnavailableReason.cliNotFound(agent.displayName, error instanceof AgentError ? error.message : ''));
      }
      if (built === TIMED_OUT) throw tooSlow();
      command = built;
    } finally {
      deadline.clear();
    }
    const workspace = getWorkspace(session.workspaceId);
    if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
    // Bounded (E3-R5): an agent that won't stop leaves the chat driving, idle; its next message waits for it.
    const releaseStarted = Date.now();
    const released = releaseAgent(session.id);
    if (!(await within(released, TERMINAL_RELEASE_TIMEOUT_MS))) {
      internalError(session.id, new TerminalHandoffError('terminal_release_timeout'));
      // It goes on stopping, unwatched: one log line when it has (story 3.9; 3.4 review F5).
      const late = () => internalError(session.id, new TerminalHandoffError('terminal_release_late', Date.now() - releaseStarted));
      released.then(late, late);
      throw new SessionNotIdleError(`${agent.displayName} is still stopping. Try again.`);
    }
    // The agent has stopped: its record is complete, so what the terminal adds comes after the mark.
    await markTerminalImport(session, agentSessionId);
    if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
    let cli: TerminalProcess;
    const opening = terminal.open({
      file: command.file,
      args: command.args,
      // The real-cased path, as the agent had it: the CLI finds its sessions by folder.
      cwd: workspace.realPath ?? workspace.path,
      env: { ...command.env, TERM: 'xterm-256color' },
      cols: TERMINAL_COLS,
      rows: TERMINAL_ROWS,
    });
    try {
      const opened = await bounded(opening, TERMINAL_STEP_TIMEOUT_MS);
      if (opened === TIMED_OUT) {
        // A CLI that starts after all is stopped at once: nothing drives it.
        opening.then(
          (late) => late.kill(),
          () => undefined,
        );
        throw tooSlow();
      }
      cli = opened;
    } catch (error) {
      if (error instanceof TerminalUnavailableError) throw error;
      internalError(session.id, error);
      throw new TerminalUnavailableError('pty_unavailable', `${agent.displayName}'s terminal couldn't start. Try again.`);
    }
    let markExited!: () => void;
    const entry: Terminal = {
      process: cli,
      backlog: '',
      size: { cols: TERMINAL_COLS, rows: TERMINAL_ROWS },
      viewers: new Set(),
      data: new Set(),
      end: new Set(),
      ended: false,
      exited: new Promise<void>((resolve) => (markExited = resolve)),
      exit: undefined,
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
      // Stopped by a switch back, a close or a delete: they finish it.
      if (terminals.get(session.id) !== entry) return;
      // Exited while this switch still holds the session: it finishes it below.
      if (switching.has(session.id)) {
        entry.exit = { exitCode };
        return;
      }
      // The CLI exited by itself (`/exit`, a crash): the chat drives again, under the lock.
      holdingSwitch(session.id, () => cliExited(session.id, entry, exitCode)).catch((error: unknown) => internalError(session.id, error));
    });
    if (ctx.closing) {
      await stopTerminal(session.id);
      throw new InvalidOperationError('Ogden Agents is stopping.');
    }
    // From here a crash before the switch back still imports its turns, at the next start (user decision).
    if (agent.terminalResume?.transcript !== undefined) setImportPending(session.id, '1');
    let switched: Session;
    try {
      switched = entities.setSessionDriver(session.id, 'terminal', 'user');
    } catch (error) {
      await stopTerminal(session.id);
      throw error;
    }
    // A CLI that crashed as it started hands the chat straight back, with its note.
    if (entry.exit !== undefined) return cliExited(session.id, entry, entry.exit.exitCode);
    // The chat's mode became stricter while the CLI started (Developer mode turned off): never left skipping checks.
    const now = entities.getSession(session.id)?.permissionMode ?? 'ask';
    if (PERMISSION_MODE_RANK[now] < PERMISSION_MODE_RANK[permissionMode]) {
      await stopTerminal(session.id);
      await importTerminalTurns(switched);
      return entities.setSessionDriver(session.id, 'ui', 'developer_mode_off');
    }
    return switched;
  };

  /**
   * Developer mode was turned off while the session's terminal skipped
   * permission checks (permission modes): core has already handed the chat
   * back (`developer_mode_off`); this stops the CLI and its tree and imports
   * its turns, under the `switching` lock, or once the switch holding the
   * session ends. Never throws.
   */
  const releaseTerminal = (sessionId: SessionId): void => {
    if (!terminals.has(sessionId) || ctx.closing) return;
    if (switching.has(sessionId)) {
      releaseAfterSwitch.add(sessionId);
      return;
    }
    holdingSwitch(sessionId, async () => {
      await stopTerminal(sessionId);
      const session = entities.getSession(sessionId);
      if (session !== undefined) await importTerminalTurns(session);
      // Core set the driver in the transaction that turned Developer mode off; this only makes sure.
      entities.setSessionDriver(sessionId, 'ui', 'developer_mode_off');
    }).catch((error: unknown) => internalError(sessionId, error));
  };

  /** Sets or clears {@link TERMINAL_IMPORT_PENDING_REF}; a failure is logged as a code. */
  const setImportPending = (sessionId: SessionId, value: '1' | '') => {
    try {
      entities.setSessionAdapterRefs(sessionId, { [TERMINAL_IMPORT_PENDING_REF]: value });
    } catch (error) {
      internalError(sessionId, new TerminalImportError('terminal_import_failed', error));
    }
  };

  /**
   * The session's CLI exited by itself (story 3.4): its viewers are told,
   * whatever it started is killed, its turns are imported and, after an
   * error exit, the agent's note says so (user decision); then the chat
   * drives again (`cli_exited`). The caller holds the `switching` lock.
   */
  const cliExited = async (sessionId: SessionId, entry: Terminal, exitCode: number | null): Promise<Session> => {
    if (terminals.get(sessionId) === entry) terminals.delete(sessionId);
    endTerminal(sessionId, entry, exitCode);
    try {
      // Its children outlive it (tools it started): the whole tree goes.
      entry.process.kill();
    } catch (error) {
      internalError(sessionId, error);
    }
    const session = entities.getSession(sessionId);
    if (session !== undefined) await importTerminalTurns(session);
    if (exitCode !== 0) {
      try {
        sessionEvents.completeMessage(sessionId, { messageId: newMessageId(), role: 'agent', content: terminalClosedNote(agentOf(sessionId).displayName, exitCode) });
      } catch (error) {
        internalError(sessionId, error);
      }
    }
    return entities.setSessionDriver(sessionId, 'ui', 'cli_exited');
  };

  /**
   * Appends the turns typed in the terminal that the chat lacks (E3-R4, story
   * 3.3): those after the mark saved when it opened, the user's marked
   * `origin: 'terminal'`, then moves the mark to the CLI's last turn so
   * nothing is imported twice. Any failure is logged as a code and imports
   * nothing more: the switch back still completes.
   */
  const importTerminalTurns = async (session: Session): Promise<void> => {
    try {
      await importTurns(session);
    } finally {
      // Tried once: a later start doesn't try again (the mark keeps a later import from repeating it anyway).
      if (entities.getSession(session.id)?.adapterRefs[TERMINAL_IMPORT_PENDING_REF] === '1') setImportPending(session.id, '');
    }
  };

  const importTurns = async (session: Session): Promise<void> => {
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

  /**
   * For `close` (AD-3: the server owns the terminals): waits, at most
   * {@link TERMINAL_CLOSE_WAIT_MS}, for the driver changes in flight, then
   * stops every terminal, imports its turns (user decision: a clean stop
   * imports them) and gives its chat back (`server_stopped`).
   */
  const closeTerminals = async (): Promise<void> => {
    const deadline = Date.now() + TERMINAL_CLOSE_WAIT_MS;
    while (switches.size > 0) {
      const left = deadline - Date.now();
      if (left <= 0 || !(await within(Promise.all([...switches]), left))) {
        for (const sessionId of switching) internalError(sessionId, new TerminalHandoffError('terminal_close_timeout'));
        break;
      }
    }
    await Promise.all(
      [...terminals.keys()].map(async (sessionId) => {
        // A switch past the wait still holds it: stop its terminal; that switch sees `closing` and ends at `ui`.
        if (switching.has(sessionId)) return stopTerminal(sessionId);
        try {
          await holdingSwitch(sessionId, async () => {
            await stopTerminal(sessionId);
            const session = entities.getSession(sessionId);
            if (session === undefined) return;
            await importTerminalTurns(session);
            entities.setSessionDriver(sessionId, 'ui', 'server_stopped');
          });
        } catch (error) {
          internalError(sessionId, error);
        }
      }),
    );
  };

  /**
   * After a stop that couldn't import (a crash), imports the terminal turns
   * of every session still marked {@link TERMINAL_IMPORT_PENDING_REF} (user
   * decision), each under its `switching` lock. Never throws: a failure,
   * of the sweep or of an import, is logged.
   */
  const importAfterRestart = (): void => {
    let pending: Session[];
    try {
      pending = entities
        .listWorkspaces()
        .flatMap((workspace) => entities.listSessions(workspace.id))
        .filter((session) => session.adapterRefs[TERMINAL_IMPORT_PENDING_REF] === '1');
    } catch (error) {
      // A start never fails over it (review F4); the turns stay pending for the next one. No session to name.
      internalError('' as SessionId, error);
      return;
    }
    for (const session of pending) {
      if (switching.has(session.id) || terminals.has(session.id)) continue;
      holdingSwitch(session.id, () => importTerminalTurns(session)).catch((error: unknown) => internalError(session.id, error));
    }
  };

  const sameSize = (a: TerminalSize, b: TerminalSize) => a.cols === b.cols && a.rows === b.rows;

  /** A size within `1..MAX_TERMINAL_COLS` × `1..MAX_TERMINAL_ROWS` (the schema checks it too), or `undefined` for a non-finite one. */
  const clampSize = (cols: number, rows: number): TerminalSize | undefined => {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return undefined;
    const clamp = (value: number, max: number) => Math.min(max, Math.max(1, Math.round(value)));
    return { cols: clamp(cols, MAX_TERMINAL_COLS), rows: clamp(rows, MAX_TERMINAL_ROWS) };
  };

  /** Gives the terminal `size` and tells its viewers, all but `except`. */
  const applySize = (sessionId: SessionId, terminal: Terminal, size: TerminalSize, except: TerminalViewerEntry | undefined) => {
    terminal.process.resize(size.cols, size.rows);
    terminal.size = { ...size };
    for (const viewer of [...terminal.viewers]) {
      if (viewer === except) continue;
      for (const listener of [...viewer.sized]) {
        try {
          listener({ ...size });
        } catch (error) {
          internalError(sessionId, error);
        }
      }
    }
  };

  const methods: Pick<Chat, 'switchDriver' | 'attachTerminal'> = {
    async switchDriver(workspaceId, sessionId, driver) {
      if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
      const session = getSession(workspaceId, sessionId);
      if (switching.has(sessionId)) throw new SessionNotIdleError('This chat is already switching. Try again in a moment.');
      if (session.driver === driver) return session;
      return holdingSwitch(sessionId, () => (driver === 'terminal' ? toTerminal(session) : toChat(session)));
    },

    attachTerminal(sessionId) {
      const terminal = terminals.get(sessionId);
      if (terminal === undefined || terminal.ended) return undefined;
      const self: TerminalViewerEntry = { size: undefined, sized: new Set() };
      terminal.viewers.add(self);
      const subscriptions = new Set<() => void>();
      let detached = false;
      /** Adds `listener` to `set` until it is unsubscribed or the viewer detaches. */
      const hold = <T>(set: Set<T>, listener: T): (() => void) => {
        if (detached) return () => undefined;
        set.add(listener);
        const off = () => {
          set.delete(listener);
          subscriptions.delete(off);
        };
        subscriptions.add(off);
        return off;
      };
      return {
        get backlog() {
          return terminal.backlog;
        },
        get size() {
          return { ...terminal.size };
        },
        onData: (listener) => hold(terminal.data, listener),
        onEnd: (listener) => hold(terminal.end, listener),
        onSize: (listener) => hold(self.sized, listener),
        write(data) {
          if (detached || terminal.ended) return;
          // Whoever types last sets the size (epic decision): every viewer is told, the typer's own screen may have followed another's.
          if (self.size !== undefined && !sameSize(self.size, terminal.size)) applySize(sessionId, terminal, self.size, undefined);
          terminal.process.write(data);
        },
        resize(cols, rows) {
          if (detached || terminal.ended) return;
          const size = clampSize(cols, rows);
          if (size === undefined) return;
          self.size = size;
          // The resizer is already at its size: only the others are told.
          if (!sameSize(size, terminal.size)) applySize(sessionId, terminal, size, self);
        },
        detach() {
          if (detached) return;
          detached = true;
          for (const off of [...subscriptions]) off();
          self.sized.clear();
          terminal.viewers.delete(self);
        },
      };
    },
  };

  return { endTerminal, stopTerminal, toTerminal, importTerminalTurns, toChat, closeTerminals, importAfterRestart, releaseTerminal, ...methods };
}
