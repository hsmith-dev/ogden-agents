/**
 * What the panes use-case offers and is given (epic 16, story 16.2 onward):
 * its public shapes, apart from `panes.ts` so that file holds the behaviour.
 */
import type { Pane, PaneId, PaneLauncherStatus, PaneLayout, PanePlacement, WorkspaceId } from '@ogden-agents/shared';
import type { TerminalSize } from './chat/types.js';
import type { Entities } from './entities.js';
import type { EventLog } from './event-log.js';
import type { InstallSettings } from './install-settings.js';
import type { PaneLaunchers } from './pane-launchers.js';
import type { PaneStore } from './pane-store.js';
import type { TerminalAvailability, TerminalCommand, TerminalPort } from './terminal-port.js';

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
  /** Turns a pane's notifications on or off (the user's opt in; off by default). `NotFoundError` for an unknown pane. */
  setNotify(workspaceId: WorkspaceId, paneId: PaneId, on: boolean): Pane;
  /** Renames a pane; `ValidationError` for a name with control characters or no name. `NotFoundError` for an unknown pane. */
  rename(workspaceId: WorkspaceId, paneId: PaneId, title: string): Pane;
  /** Stops the pane's program and everything it started, and forgets the pane. `NotFoundError` for an unknown or another project's pane. */
  close(workspaceId: WorkspaceId, paneId: PaneId): void;
  /** Restart pane: stops what is left of the pane's program and starts it again in the same pane (same id, same project folder). */
  restart(workspaceId: WorkspaceId, paneId: PaneId, size: TerminalSize, args?: string): Promise<Pane>;
  /** A hold on a pane, or `undefined` for an unknown one. `DeveloperModeRequiredError` without Developer mode. */
  attach(paneId: PaneId): PaneViewer | undefined;
  /** How many panes are open now (every project). */
  count(): number;
  /** How many panes' programs are running now (not stopped, not ended). */
  runningCount(): number;
  /**
   * Developer mode is about to be turned off and the user chose to keep running
   * panes going (story 16.9): the next change leaves them running in the
   * background until the server stops, instead of stopping them.
   */
  keepRunningOnNextDeveloperModeOff(keep?: boolean): void;
  /** Stops every pane's program and what it started (the server stopping, Developer mode turned off); the panes stay, `stopped`. */
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
  /** Where panes and layouts are kept between runs (story 16.7). Without it they live only while the server runs. */
  store?: PaneStore | undefined;
  /** Records each program's pid (and forgets it when it ends), for the sweep after a hard stop (story 16.7). */
  pids?: { add(pid: number): void; remove(pid: number): void } | undefined;
  /** The launchers whose panes the user opted in to notifications (story 16.9 keeps the setting). Read at each status change. */
  notifyLaunchers?: (() => readonly string[]) | undefined;
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
