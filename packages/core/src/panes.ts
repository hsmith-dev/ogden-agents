/**
 * Terminal panes (epic 16, story 16.2; E16-R1, R3): a project's pseudo-
 * terminals, each running one program (the tracer: the user's plain shell) in
 * the project folder, opened through the {@link TerminalPort}. Core names no
 * CLI and no terminal library: what to run and with what environment are
 * given by the server (`shell`, `env`).
 *
 * - Developer mode gates every operation, here, not only in the page
 *   (`DeveloperModeRequiredError`, 403 `developer_mode_required`).
 *   Turning Developer mode off stops every pane (story 16.9 refines this).
 * - A pane is separate from a chat session: it never drives a session's
 *   `driver` and never touches an agent (E16-R1).
 * - Panes are in memory: they end when the server stops (story 16.7 stores
 *   the layout, never the output).
 * - What a pane prints and what is typed into it is never logged, evented or
 *   stored here (AD-6, AD-16); only a pane's state changes and why.
 */
import type { Pane, PaneId, PaneState, TerminalUnavailableCode, WorkspaceId } from '@ogden-agents/shared';
import { MAX_PANES_PER_INSTALL, MAX_PANES_PER_PROJECT, MAX_TERMINAL_COLS, MAX_TERMINAL_ROWS } from '@ogden-agents/shared';
import type { TerminalSize } from './chat/types.js';
import type { Entities } from './entities.js';
import { DeveloperModeRequiredError, NotFoundError, PANES_NEED_DEVELOPER_MODE, PaneLimitError, TerminalUnavailableError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import type { InstallSettings } from './install-settings.js';
import type { PaneProcess, TerminalAvailability, TerminalCommand, TerminalPort } from './terminal-port.js';
import { plainTerminalReason, terminalUnavailableReason } from './terminal-reasons.js';

/** Lines of scrollback a pane's screen mirror keeps (spike 16.1 finding 3). */
export const PANE_SCROLLBACK_LINES = 5_000;

/** One viewer's hold on a pane (a browser tab's socket). The pane runs on, with or without viewers. */
export interface PaneViewer {
  /** The pane as it is now. */
  readonly pane: Pane;
  /** The size the pane is at now. */
  readonly size: TerminalSize;
  /**
   * Starts the viewer's feed: `onSnapshot` with the screen as it is (the
   * viewer resets and writes it), then `onData` with what is printed after.
   * After Restart pane, `onSnapshot` is called again with the new program's
   * screen. Call it once.
   */
  attach(onSnapshot: (snapshot: string) => void, onData: (data: string) => void): void;
  /** The pane changed state (`starting`, `running`, `exited`), or restarted. Returns the unsubscribe. */
  onState(listener: (pane: Pane) => void): () => void;
  /** The pane was closed (by the user, Developer mode off or the server stopping). Returns the unsubscribe. */
  onClose(listener: () => void): () => void;
  /** The pane's new size: another viewer resized it, or a viewer typed and the pane took that viewer's size. Returns the unsubscribe. */
  onSize(listener: (size: TerminalSize) => void): () => void;
  /** Types into the pane, first giving it this viewer's size if it has one and the pane is at another. */
  write(data: string): void;
  /** Sets this viewer's size, clamped; the pane takes it and the other viewers are told when it changed. */
  resize(cols: number, rows: number): void;
  /** Lets go of the pane: its listeners are removed. The pane runs on. */
  detach(): void;
}

export interface Panes {
  /** Whether a pane can open on this computer, or the plain reason it can't (AD-19). */
  available(): Promise<TerminalAvailability>;
  /** A project's panes, oldest first. `DeveloperModeRequiredError` without Developer mode. */
  list(workspaceId: WorkspaceId): Pane[];
  /**
   * Opens a pane in the project folder, starting its program at `size`. The pane
   * is `starting` until the program prints. `DeveloperModeRequiredError`,
   * `NotFoundError` (no such project), `PaneLimitError`, `TerminalUnavailableError`
   * when `node-pty` can't load or the program can't start (nothing is left open then).
   */
  open(workspaceId: WorkspaceId, size: TerminalSize): Promise<Pane>;
  /** Stops the pane's program and everything it started, and forgets the pane. `NotFoundError` for an unknown or another project's pane. */
  close(workspaceId: WorkspaceId, paneId: PaneId): void;
  /** Restart pane: stops what is left of the pane's program and starts it again in the same pane (same id, same project folder). */
  restart(workspaceId: WorkspaceId, paneId: PaneId, size: TerminalSize): Promise<Pane>;
  /** A hold on a pane, or `undefined` for an unknown one. `DeveloperModeRequiredError` without Developer mode. */
  attach(paneId: PaneId): PaneViewer | undefined;
  /** How many panes are open now (every project). */
  count(): number;
  /** Stops every pane and its program (the server stopping, Developer mode turned off). */
  closeAll(): void;
  /** {@link closeAll}, and stops following Developer mode. */
  dispose(): void;
}

export interface PanesOptions {
  entities: Pick<Entities, 'getWorkspace'>;
  installSettings: Pick<InstallSettings, 'developerMode'>;
  /** The log, followed for Developer mode turning off. Without it panes are stopped only by the server. */
  events?: Pick<EventLog, 'subscribe' | 'lastSeq'> | undefined;
  /** Without a terminal port (or one without `openPane`) no pane can open. */
  terminal: TerminalPort | undefined;
  /** The program a plain shell pane runs: the user's own shell, by absolute path. */
  shell: () => TerminalCommand;
  /** The pane program's whole environment (AD-16: the server builds it from the allowlist; never a secret). */
  env: () => Readonly<Record<string, string>>;
  /** Told a failure that is not the caller's (a viewer's callback threw), for the log. Never the pane's text. */
  onError?: ((error: unknown) => void) | undefined;
  limits?: { perProject?: number; perInstall?: number } | undefined;
  scrollback?: number | undefined;
}

interface ViewerEntry {
  size: TerminalSize | undefined;
  sized: Set<(size: TerminalSize) => void>;
  states: Set<(pane: Pane) => void>;
  closes: Set<() => void>;
  feed: { onSnapshot: (snapshot: string) => void; onData: (data: string) => void } | undefined;
  /** Unsubscribes the feed from the program it is bound to. */
  unbind: (() => void) | undefined;
}

interface Entry {
  pane: Pane;
  cwd: string;
  process: PaneProcess | undefined;
  size: TerminalSize;
  viewers: Set<ViewerEntry>;
  closed: boolean;
}

const clamp = (value: number, max: number) => Math.min(Math.max(Math.floor(value), 1), max);

export function createPanes(options: PanesOptions): Panes {
  const { entities, installSettings, terminal, events } = options;
  const perProject = options.limits?.perProject ?? MAX_PANES_PER_PROJECT;
  const perInstall = options.limits?.perInstall ?? MAX_PANES_PER_INSTALL;
  const scrollback = options.scrollback ?? PANE_SCROLLBACK_LINES;
  const entries = new Map<PaneId, Entry>();

  const requireDeveloperMode = () => {
    if (!installSettings.developerMode()) throw new DeveloperModeRequiredError(PANES_NEED_DEVELOPER_MODE);
  };
  const safely = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      options.onError?.(error);
    }
  };
  const available = async (): Promise<TerminalAvailability> => {
    if (terminal === undefined || terminal.openPane === undefined) return { ok: false, reason: terminalUnavailableReason.noTerminalPort() };
    return terminal.available();
  };

  const setState = (entry: Entry, state: PaneState, exitCode: number | null = null) => {
    if (entry.pane.state === state && entry.pane.exitCode === exitCode) return;
    entry.pane = { ...entry.pane, state, exitCode };
    for (const viewer of [...entry.viewers]) for (const listener of [...viewer.states]) safely(() => listener(entry.pane));
  };

  /** Binds a viewer's feed to the pane's current program, if both exist. */
  const bind = (entry: Entry, viewer: ViewerEntry) => {
    viewer.unbind?.();
    viewer.unbind = undefined;
    const process = entry.process;
    const feed = viewer.feed;
    if (process === undefined || feed === undefined) return;
    viewer.unbind = process.attach(
      (snapshot) => safely(() => feed.onSnapshot(snapshot)),
      (data) => safely(() => feed.onData(data)),
    );
  };

  /** Starts the pane's program at `size`; the pane is `starting` until it prints. */
  const start = async (entry: Entry, size: TerminalSize): Promise<void> => {
    if (terminal?.openPane === undefined) throw new TerminalUnavailableError('pty_unavailable', terminalUnavailableReason.noTerminalPort());
    const command = options.shell();
    let process: PaneProcess;
    try {
      process = await terminal.openPane({ file: command.file, args: command.args, cwd: entry.cwd, env: options.env(), cols: size.cols, rows: size.rows, scrollback });
    } catch (error) {
      // Plain words only: a spawn error can name a path.
      const reason = error instanceof Error ? plainTerminalReason(error.message, 'the terminal could not be started') : 'the terminal could not be started';
      throw new TerminalUnavailableError('pty_unavailable' satisfies TerminalUnavailableCode, terminalUnavailableReason.ptyUnavailable(reason));
    }
    if (entry.closed) {
      process.kill();
      return;
    }
    entry.process = process;
    entry.size = size;
    setState(entry, 'starting');
    let printed = false;
    const unsubscribe = process.onData(() => {
      if (printed) return;
      printed = true;
      unsubscribe();
      if (entry.process === process) setState(entry, 'running');
    });
    process.onExit(({ exitCode }) => {
      // A program replaced by Restart pane (or closed) reports its end too: only the current one counts.
      if (entry.process === process && !entry.closed) setState(entry, 'exited', exitCode);
    });
    for (const viewer of entry.viewers) bind(entry, viewer);
  };

  const find = (workspaceId: WorkspaceId, paneId: PaneId): Entry => {
    const entry = entries.get(paneId);
    if (entry === undefined || entry.pane.workspaceId !== workspaceId) throw new NotFoundError('pane', paneId);
    return entry;
  };

  const forget = (entry: Entry) => {
    if (entry.closed) return;
    entry.closed = true;
    entries.delete(entry.pane.id);
    const process = entry.process;
    entry.process = undefined;
    process?.kill();
    for (const viewer of [...entry.viewers]) {
      viewer.unbind?.();
      viewer.unbind = undefined;
      for (const listener of [...viewer.closes]) safely(listener);
    }
  };

  const closeAll = () => {
    for (const entry of [...entries.values()]) forget(entry);
  };

  let unfollow: (() => void) | undefined;
  if (events !== undefined) {
    // Developer mode turned off: no pane may keep running unseen (story 16.9 asks the user what to do).
    unfollow = events.subscribe(events.lastSeq(), (event) => {
      if (event.type === 'settings.developer_mode_changed' && !event.payload.developerMode) closeAll();
    });
  }

  const titleFor = (workspaceId: WorkspaceId): string => {
    const taken = new Set([...entries.values()].filter((e) => e.pane.workspaceId === workspaceId).map((e) => e.pane.title));
    for (let n = 1; ; n += 1) if (!taken.has(`Terminal ${n}`)) return `Terminal ${n}`;
  };

  return {
    available,

    list(workspaceId) {
      requireDeveloperMode();
      return [...entries.values()].filter((e) => e.pane.workspaceId === workspaceId).map((e) => e.pane);
    },

    async open(workspaceId, size) {
      requireDeveloperMode();
      const workspace = entities.getWorkspace(workspaceId);
      if (workspace === undefined) throw new NotFoundError('project', workspaceId);
      const pty = await available();
      if (!pty.ok) throw new TerminalUnavailableError('pty_unavailable', terminalUnavailableReason.ptyUnavailable(pty.reason));
      // Checked and taken in one tick (below), so a burst of opens can't pass the limits.
      requireDeveloperMode();
      if (entries.size >= perInstall) throw new PaneLimitError('install', perInstall);
      if ([...entries.values()].filter((e) => e.pane.workspaceId === workspaceId).length >= perProject) throw new PaneLimitError('project', perProject);
      const entry: Entry = {
        pane: { id: newId('pan'), workspaceId, launcherId: 'shell', title: titleFor(workspaceId), state: 'starting', exitCode: null },
        cwd: workspace.realPath ?? workspace.path,
        process: undefined,
        size: { cols: clamp(size.cols, MAX_TERMINAL_COLS), rows: clamp(size.rows, MAX_TERMINAL_ROWS) },
        viewers: new Set(),
        closed: false,
      };
      // The slot is taken before the program starts.
      entries.set(entry.pane.id, entry);
      try {
        await start(entry, entry.size);
      } catch (error) {
        entries.delete(entry.pane.id);
        entry.closed = true;
        throw error;
      }
      // Closed while it started (Developer mode turned off): nothing is left running.
      if (entry.closed) throw new DeveloperModeRequiredError(PANES_NEED_DEVELOPER_MODE);
      return entry.pane;
    },

    close(workspaceId, paneId) {
      requireDeveloperMode();
      forget(find(workspaceId, paneId));
    },

    async restart(workspaceId, paneId, size) {
      requireDeveloperMode();
      const entry = find(workspaceId, paneId);
      const old = entry.process;
      entry.process = undefined;
      for (const viewer of entry.viewers) {
        viewer.unbind?.();
        viewer.unbind = undefined;
      }
      old?.kill();
      setState(entry, 'starting');
      try {
        await start(entry, { cols: clamp(size.cols, MAX_TERMINAL_COLS), rows: clamp(size.rows, MAX_TERMINAL_ROWS) });
      } catch (error) {
        // It could not start again: the pane stays, stopped, so Restart can be tried once more.
        setState(entry, 'exited');
        throw error;
      }
      return entry.pane;
    },

    attach(paneId) {
      requireDeveloperMode();
      const entry = entries.get(paneId);
      if (entry === undefined) return undefined;
      const viewer: ViewerEntry = { size: undefined, sized: new Set(), states: new Set(), closes: new Set(), feed: undefined, unbind: undefined };
      entry.viewers.add(viewer);
      const applySize = (size: TerminalSize) => {
        if (entry.closed || (size.cols === entry.size.cols && size.rows === entry.size.rows)) return;
        entry.size = size;
        entry.process?.resize(size.cols, size.rows);
        for (const other of entry.viewers) for (const listener of [...other.sized]) safely(() => listener(size));
      };
      return {
        get pane() {
          return entry.pane;
        },
        get size() {
          return entry.size;
        },
        attach(onSnapshot, onData) {
          viewer.feed = { onSnapshot, onData };
          bind(entry, viewer);
        },
        onState(listener) {
          viewer.states.add(listener);
          return () => void viewer.states.delete(listener);
        },
        onClose(listener) {
          viewer.closes.add(listener);
          return () => void viewer.closes.delete(listener);
        },
        onSize(listener) {
          viewer.sized.add(listener);
          return () => void viewer.sized.delete(listener);
        },
        write(data) {
          if (viewer.size !== undefined) applySize(viewer.size);
          entry.process?.write(data);
        },
        resize(cols, rows) {
          if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
          const size = { cols: clamp(cols, MAX_TERMINAL_COLS), rows: clamp(rows, MAX_TERMINAL_ROWS) };
          viewer.size = size;
          applySize(size);
        },
        detach() {
          viewer.unbind?.();
          viewer.unbind = undefined;
          viewer.feed = undefined;
          viewer.sized.clear();
          viewer.states.clear();
          viewer.closes.clear();
          entry.viewers.delete(viewer);
        },
      };
    },

    count: () => entries.size,
    closeAll,
    dispose() {
      unfollow?.();
      unfollow = undefined;
      closeAll();
    },
  };
}
