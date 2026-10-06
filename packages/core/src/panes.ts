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
import type { NewCoreEvent, Pane, PaneLauncherStatus, PaneStatus, PaneId, PaneLayout, PanePlacement, PaneState, TerminalUnavailableCode, WorkspaceId } from '@ogden-agents/shared';
import { PaneTitle } from '@ogden-agents/shared';
import { createStatusTracker, type StatusTracker } from './pane-status.js';
import { splitLauncherArgs, type PaneLaunchers } from './pane-launchers.js';
import { addTab, EMPTY_LAYOUT, layoutPaneIds, rearrangement, removePane, splitPane } from './pane-layout.js';
import { MAX_PANES_PER_INSTALL, MAX_PANES_PER_PROJECT, MAX_TERMINAL_COLS, MAX_TERMINAL_ROWS } from '@ogden-agents/shared';
import type { TerminalSize } from './chat/types.js';
import type { Entities } from './entities.js';
import { DeveloperModeRequiredError, LauncherUnavailableError, NotFoundError, ValidationError, PANES_NEED_DEVELOPER_MODE, PaneLimitError, TerminalUnavailableError } from './errors.js';
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

/** What a new pane runs (story 16.5): a launcher (default the user's shell) and what the user typed in its argument field. */
export interface PaneLaunch {
  launcherId?: string | undefined;
  args?: string | undefined;
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
  open(workspaceId: WorkspaceId, size: TerminalSize, placement?: PanePlacement, launch?: PaneLaunch): Promise<Pane>;
  /** What a pane can run besides the shell, with what detection found (story 16.5); `refresh` looks again (Detect). Developer mode only. */
  launchers(refresh?: boolean): Promise<PaneLauncherStatus[]>;
  /** The project's layout: tabs of split trees of its panes (story 16.4). Never refused for a project with no panes: it is empty then. */
  layout(workspaceId: WorkspaceId): PaneLayout;
  /**
   * Changes the arrangement only (ratios, tab names and order, the active tab, which pane sits where) to `layout`;
   * `ValidationError` unless it holds the same panes, each exactly once.
   */
  arrange(workspaceId: WorkspaceId, layout: unknown): PaneLayout;
  /** Renames a pane; `ValidationError` for a name with control characters or no name. `NotFoundError` for an unknown pane. */
  rename(workspaceId: WorkspaceId, paneId: PaneId, title: string): Pane;
  /** Stops the pane's program and everything it started, and forgets the pane. `NotFoundError` for an unknown or another project's pane. */
  close(workspaceId: WorkspaceId, paneId: PaneId): void;
  /** Restart pane: stops what is left of the pane's program and starts it again in the same pane (same id, same project folder). */
  restart(workspaceId: WorkspaceId, paneId: PaneId, size: TerminalSize): Promise<Pane>;
  /** A hold on a pane, or `undefined` for an unknown one. `DeveloperModeRequiredError` without Developer mode. */
  attach(paneId: PaneId): PaneViewer | undefined;
  /** How many panes are open now (every project). */
  count(): number;
  /** Stops every pane and its program (the server stopping, Developer mode turned off). */
  closeAll(cause?: 'user' | 'developer_mode_off' | 'server_stopped'): void;
  /** {@link closeAll}, and stops following Developer mode. */
  dispose(): void;
}

export interface PanesOptions {
  entities: Pick<Entities, 'getWorkspace'>;
  installSettings: Pick<InstallSettings, 'developerMode'>;
  /** The log: followed for Developer mode turning off, and given the pane events (state only, never a pane's text). */
  events?: Pick<EventLog, 'subscribe' | 'lastSeq' | 'append'> | undefined;
  /** Without a terminal port (or one without `openPane`) no pane can open. */
  terminal: TerminalPort | undefined;
  /** The launchers (story 16.5). Without it only the plain shell opens. */
  launchers?: PaneLaunchers | undefined;
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
  /** What the launcher resolved at open. Restart pane resolves it again (the program may have moved); the shell is looked up each time. */
  command: TerminalCommand | undefined;
  /** The arguments the user typed, read (kept for Restart pane). */
  typed: readonly string[];
  process: PaneProcess | undefined;
  /** Its status guess (story 16.6), over the current program. */
  tracker: StatusTracker | undefined;
  size: TerminalSize;
  viewers: Set<ViewerEntry>;
  closed: boolean;
  /** Whether `pane_opened` was appended: only then is a `pane_closed` (a pane never announced is never retracted). */
  announced: boolean;
}

type PaneClosedCause = 'user' | 'developer_mode_off' | 'server_stopped';

const clamp = (value: number, max: number) => Math.min(Math.max(Math.floor(value), 1), max);

export function createPanes(options: PanesOptions): Panes {
  const { entities, installSettings, terminal, events } = options;
  const perProject = options.limits?.perProject ?? MAX_PANES_PER_PROJECT;
  const perInstall = options.limits?.perInstall ?? MAX_PANES_PER_INSTALL;
  const scrollback = options.scrollback ?? PANE_SCROLLBACK_LINES;
  const entries = new Map<PaneId, Entry>();
  /** Each project's layout (story 16.7 stores it). */
  const layouts = new Map<WorkspaceId, PaneLayout>();
  const layoutOf = (workspaceId: WorkspaceId): PaneLayout => layouts.get(workspaceId) ?? EMPTY_LAYOUT;
  /** Set when the server stops: nothing opens after it. */
  let disposed = false;

  const requireDeveloperMode = () => {
    if (!installSettings.developerMode()) throw new DeveloperModeRequiredError(PANES_NEED_DEVELOPER_MODE);
  };
  /** Developer mode checked again on what a live viewer does; off, the pane is stopped (never typed into). */
  const developerModeOn = (entry: Entry): boolean => {
    if (installSettings.developerMode()) return true;
    forget(entry, 'developer_mode_off');
    return false;
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

  /** Appends a pane event (state only); a failure never reaches the pane. */
  let deferring: NewCoreEvent[] | undefined;
  const emit = (event: NewCoreEvent) => {
    if (events === undefined) return;
    // Inside an event listener the log would deliver a nested append before the event being delivered: held until the listener is done.
    if (deferring !== undefined) {
      deferring.push(event);
      return;
    }
    safely(() => void events.append(event));
  };
  const setLayout = (workspaceId: WorkspaceId, layout: PaneLayout) => {
    if (layout.tabs.length === 0) layouts.delete(workspaceId);
    else layouts.set(workspaceId, layout);
    emit({ type: 'terminal.layout_changed', workspaceId, streamId: workspaceId, payload: { tabCount: layout.tabs.length, paneCount: layoutPaneIds(layout).length } });
  };
  /** A status change: the pane, its viewers and an event (state only, with the pane's name). */
  const setStatus = (entry: Entry, status: PaneStatus, previous: PaneStatus = entry.pane.status) => {
    if (entry.pane.status === status) return;
    entry.pane = { ...entry.pane, status };
    for (const viewer of [...entry.viewers]) for (const listener of [...viewer.states]) safely(() => listener(entry.pane));
    if (entry.announced) emit({ type: 'terminal.pane_status_changed', workspaceId: entry.pane.workspaceId, streamId: entry.pane.workspaceId, payload: { paneId: entry.pane.id, status, previous, title: entry.pane.title } });
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
    let process: PaneProcess;
    try {
      const command = entry.command ?? options.shell();
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
    // A second Restart that started meanwhile: only one program per pane, the other stops.
    entry.process?.kill();
    entry.process = process;
    entry.tracker?.dispose();
    entry.tracker = createStatusTracker({
      // The launcher's own words for waiting on the user; the shell and an unknown program have none, so they are only working or idle.
      patterns: options.launchers?.get(entry.pane.launcherId)?.promptPatterns ?? [],
      screenLines: (count) => process.screenLines(count),
      onChange: (status, previous) => setStatus(entry, status, previous),
    });
    const tracker = entry.tracker;
    process.onData(() => tracker.output());
    if (size.cols !== entry.size.cols || size.rows !== entry.size.rows) {
      entry.size = size;
      for (const viewer of entry.viewers) for (const listener of [...viewer.sized]) safely(() => listener(size));
    }
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
      if (entry.process === process && !entry.closed) {
        setState(entry, 'exited', exitCode);
        tracker.exited();
        emit({ type: 'terminal.pane_exited', workspaceId: entry.pane.workspaceId, streamId: entry.pane.workspaceId, payload: { paneId: entry.pane.id, exitCode } });
      }
    });
    for (const viewer of entry.viewers) bind(entry, viewer);
  };

  const find = (workspaceId: WorkspaceId, paneId: PaneId): Entry => {
    const entry = entries.get(paneId);
    if (entry === undefined || entry.pane.workspaceId !== workspaceId) throw new NotFoundError('pane', paneId);
    return entry;
  };

  const forget = (entry: Entry, cause: PaneClosedCause = 'user') => {
    if (entry.closed) return;
    entry.closed = true;
    entries.delete(entry.pane.id);
    if (entry.announced) setLayout(entry.pane.workspaceId, removePane(layoutOf(entry.pane.workspaceId), entry.pane.id));
    if (entry.announced) emit({ type: 'terminal.pane_closed', workspaceId: entry.pane.workspaceId, streamId: entry.pane.workspaceId, payload: { paneId: entry.pane.id, cause } });
    const process = entry.process;
    entry.process = undefined;
    entry.tracker?.dispose();
    entry.tracker = undefined;
    process?.kill();
    for (const viewer of [...entry.viewers]) {
      viewer.unbind?.();
      viewer.unbind = undefined;
      for (const listener of [...viewer.closes]) safely(listener);
    }
  };

  const closeAll = (cause: PaneClosedCause = 'server_stopped') => {
    for (const entry of [...entries.values()]) forget(entry, cause);
  };

  let unfollow: (() => void) | undefined;
  if (events !== undefined) {
    // Developer mode turned off: no pane may keep running unseen (story 16.9 asks the user what to do).
    unfollow = events.subscribe(events.lastSeq(), (event) => {
      if (event.type === 'settings.developer_mode_changed' && !event.payload.developerMode) {
        deferring = [];
        try {
          closeAll('developer_mode_off');
        } finally {
          const held = deferring;
          deferring = undefined;
          // After this delivery finished, so every subscriber hears the settings event first and in order.
          queueMicrotask(() => {
            for (const heldEvent of held) emit(heldEvent);
          });
        }
      }
    });
  }

  const titleFor = (workspaceId: WorkspaceId, label = 'Terminal'): string => {
    const taken = new Set([...entries.values()].filter((e) => e.pane.workspaceId === workspaceId).map((e) => e.pane.title));
    for (let n = 1; ; n += 1) if (!taken.has(`${label} ${n}`)) return `${label} ${n}`;
  };

  return {
    available,

    list(workspaceId) {
      requireDeveloperMode();
      return [...entries.values()].filter((e) => e.pane.workspaceId === workspaceId).map((e) => e.pane);
    },

    async open(workspaceId, size, placement, launch) {
      requireDeveloperMode();
      if (disposed) throw new DeveloperModeRequiredError(PANES_NEED_DEVELOPER_MODE);
      const workspace = entities.getWorkspace(workspaceId);
      if (workspace === undefined) throw new NotFoundError('project', workspaceId);
      // What to run, looked up before a slot is taken: a launcher that is not there opens nothing.
      let command: TerminalCommand | undefined;
      let label: string | undefined;
      let typed: readonly string[] = [];
      const launcherId = launch?.launcherId ?? 'shell';
      if (launcherId !== 'shell') {
        const launcher = options.launchers?.get(launcherId);
        const read = launch?.args === undefined ? [] : splitLauncherArgs(launch.args);
        if (launcher === undefined || launcher.kind === 'shell') throw new LauncherUnavailableError('unknown_launcher', 'That program is not one Ogden Agents can start.');
        if (read === undefined) throw new ValidationError('The arguments are not closed quotes or are too many.', [{ path: ['args'], message: 'unreadable arguments' }]);
        typed = read;
        const found = await options.launchers!.command(launcherId, typed);
        if (!found.ok) throw new LauncherUnavailableError(found.code, found.reason, launcher.installUrl);
        command = { file: found.file, args: found.args };
        label = launcher.label;
      }
      const pty = await available();
      if (!pty.ok) throw new TerminalUnavailableError('pty_unavailable', terminalUnavailableReason.ptyUnavailable(pty.reason));
      // Checked and taken in one tick (below), so a burst of opens can't pass the limits.
      requireDeveloperMode();
      if (entries.size >= perInstall) throw new PaneLimitError('install', perInstall);
      if ([...entries.values()].filter((e) => e.pane.workspaceId === workspaceId).length >= perProject) throw new PaneLimitError('project', perProject);
      const entry: Entry = {
        pane: { id: newId('pan'), workspaceId, launcherId, title: titleFor(workspaceId, label), state: 'starting', status: 'working', exitCode: null },
        cwd: workspace.realPath ?? workspace.path,
        command,
        typed,
        process: undefined,
        tracker: undefined,
        size: { cols: clamp(size.cols, MAX_TERMINAL_COLS), rows: clamp(size.rows, MAX_TERMINAL_ROWS) },
        viewers: new Set(),
        closed: false,
        announced: false,
      };
      // The slot is taken before the program starts.
      entries.set(entry.pane.id, entry);
      try {
        await start(entry, entry.size);
      } catch (error) {
        // Found a moment ago but would not start (removed since): say so about the program, and look again for the page.
        if (entry.command !== undefined && error instanceof TerminalUnavailableError && options.launchers !== undefined) {
          void options.launchers.detect().catch(() => undefined);
          forget(entry);
          throw new LauncherUnavailableError('failed', `${label ?? 'That program'} could not be started. It may have been moved or removed. Press Detect, then try again.`, options.launchers.get(launcherId)?.installUrl);
        }
        // It never opened: no event, only the viewers that found it meanwhile are let go.
        forget(entry);
        throw error;
      }
      // Closed while it started (closed by the user, Developer mode turned off, the server stopping): nothing is left running, and nothing was announced.
      if (entry.closed || disposed) throw new NotFoundError('pane', entry.pane.id);
      entry.announced = true;
      const current = layoutOf(workspaceId);
      const split = placement?.kind === 'split' ? splitPane(current, placement.paneId, entry.pane.id, placement.direction) : undefined;
      emit({ type: 'terminal.pane_opened', workspaceId, streamId: workspaceId, payload: { paneId: entry.pane.id, launcherId: entry.pane.launcherId, title: entry.pane.title } });
      setLayout(workspaceId, split ?? addTab(current, `t${newId('pan').slice(-8).toLowerCase()}`, entry.pane.title, entry.pane.id));
      return entry.pane;
    },

    async launchers(refresh = false) {
      requireDeveloperMode();
      if (options.launchers === undefined) return [];
      return refresh ? options.launchers.detect() : options.launchers.list();
    },

    layout(workspaceId) {
      requireDeveloperMode();
      return layoutOf(workspaceId);
    },

    arrange(workspaceId, layout) {
      requireDeveloperMode();
      if (entities.getWorkspace(workspaceId) === undefined) throw new NotFoundError('project', workspaceId);
      const next = rearrangement(layoutOf(workspaceId), layout);
      if (next === undefined) throw new ValidationError('That layout is not the same terminals, each once.', [{ path: ['layout'], message: 'not a rearrangement' }]);
      // Nothing changed: nothing is saved or announced (an arrow key at the end of a divider's range).
      if (JSON.stringify(next) !== JSON.stringify(layoutOf(workspaceId))) setLayout(workspaceId, next);
      return next;
    },

    rename(workspaceId, paneId, title) {
      requireDeveloperMode();
      const entry = find(workspaceId, paneId);
      if (!entry.announced) throw new NotFoundError('pane', paneId);
      const parsed = PaneTitle.safeParse(title.trim());
      if (!parsed.success) throw new ValidationError('A terminal needs a name without control characters, up to 80 characters.', [{ path: ['title'], message: 'invalid name' }]);
      if (parsed.data !== entry.pane.title) {
        entry.pane = { ...entry.pane, title: parsed.data };
        emit({ type: 'terminal.pane_renamed', workspaceId, streamId: workspaceId, payload: { paneId, title: parsed.data } });
      }
      return entry.pane;
    },

    close(workspaceId, paneId) {
      requireDeveloperMode();
      forget(find(workspaceId, paneId));
    },

    async restart(workspaceId, paneId, size) {
      requireDeveloperMode();
      const entry = find(workspaceId, paneId);
      // A launcher's program may have moved or gone since it opened: looked up again, with the same typed arguments.
      if (entry.command !== undefined && options.launchers !== undefined) {
        const again = await options.launchers.command(entry.pane.launcherId, entry.typed);
        if (!again.ok) throw new LauncherUnavailableError(again.code, again.reason, options.launchers.get(entry.pane.launcherId)?.installUrl);
        entry.command = { file: again.file, args: again.args };
      }
      if (entry.closed) throw new NotFoundError('pane', paneId);
      const old = entry.process;
      entry.process = undefined;
      for (const viewer of entry.viewers) {
        viewer.unbind?.();
        viewer.unbind = undefined;
      }
      old?.kill();
      entry.tracker?.dispose();
      entry.tracker = undefined;
      setState(entry, 'starting');
      setStatus(entry, 'working');
      try {
        await start(entry, { cols: clamp(size.cols, MAX_TERMINAL_COLS), rows: clamp(size.rows, MAX_TERMINAL_ROWS) });
      } catch (error) {
        // It could not start again: the pane stays, stopped, so Restart can be tried once more.
        if (!entry.closed) {
          setState(entry, 'exited');
          emit({ type: 'terminal.pane_exited', workspaceId, streamId: workspaceId, payload: { paneId, exitCode: null } });
        }
        throw error;
      }
      if (entry.closed) throw new NotFoundError('pane', paneId);
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
          if (!developerModeOn(entry)) return;
          if (viewer.size !== undefined) applySize(viewer.size);
          entry.tracker?.input();
          entry.process?.write(data);
        },
        resize(cols, rows) {
          if (!developerModeOn(entry)) return;
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
      disposed = true;
      unfollow?.();
      unfollow = undefined;
      closeAll();
    },
  };
}
