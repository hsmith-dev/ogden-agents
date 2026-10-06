import { z } from 'zod';
import { PaneId, WorkspaceId } from './ids.js';
import { SessionTerminal, TerminalExitFrame, TerminalSizeFrame } from './terminal.js';

/**
 * The terminal pane contract (epic 16, story 16.2; story 16.3 freezes the
 * rest): a pane is one pseudo-terminal the server owns, running one launcher
 * in a project folder, shown by xterm in Developer mode only (E16-R1, R3).
 *
 * What a pane prints and what the user types are the user's content: they
 * travel only as binary frames on the pane socket (`PANE_SOCKET_ROUTE`) and
 * are never evented, stored or logged (AD-6, AD-16). Nothing here names a CLI.
 */

/** Panes a project may have at once (epic 16 assumption: adjustable constants). */
export const MAX_PANES_PER_PROJECT = 8;
/** Panes the whole install may have at once. */
export const MAX_PANES_PER_INSTALL = 16;

/**
 * Where a pane is in its life (E16-R11, spike 16.1 finding 2):
 * - `starting`: the program was started and has printed nothing yet (Windows
 *   ConPTY can hold the first output back; the page offers Restart pane).
 * - `running`: it has printed.
 * - `exited`: the program ended, by itself or by Restart or close.
 */
export const PaneState = z.enum(['starting', 'running', 'exited']);
export type PaneState = z.infer<typeof PaneState>;

/** The launchers a pane can run. The tracer has only the user's own shell; story 16.5 adds the CLIs as data. */
export const PaneLauncherId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export type PaneLauncherId = z.infer<typeof PaneLauncherId>;

export const Pane = z.object({
  id: PaneId,
  workspaceId: WorkspaceId,
  launcherId: PaneLauncherId,
  /** What the pane is called in the page (plain words). */
  title: z.string().min(1).max(80),
  state: PaneState,
  /** The program's own exit code once `exited`; `null` while it runs or when it was stopped. */
  exitCode: z.number().int().nullable(),
});
export type Pane = z.infer<typeof Pane>;

const size = {
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(500),
};

/** `POST` panes: the size the viewer's terminal has now, so the program starts at it. */
export const OpenPaneRequest = z.object({ ...size });
export type OpenPaneRequest = z.infer<typeof OpenPaneRequest>;

/** `POST` pane restart: the size to start at. */
export const RestartPaneRequest = z.object({ ...size });
export type RestartPaneRequest = z.infer<typeof RestartPaneRequest>;

export const PaneResponse = z.object({ pane: Pane });
export type PaneResponse = z.infer<typeof PaneResponse>;

/** `GET` panes: the project's panes, oldest first, and whether a pane can open on this computer now. */
export const PanesResponse = z.object({
  panes: z.array(Pane),
  terminal: SessionTerminal,
  limits: z.object({ perProject: z.number().int(), perInstall: z.number().int() }),
});
export type PanesResponse = z.infer<typeof PanesResponse>;

/** Server → client on the pane socket: the pane's state now (sent on attach and on every change). */
export const PaneStateFrame = z.object({ type: z.literal('state'), state: PaneState });
/**
 * Server → client: what follows is the pane's screen as it is now, not more
 * output: the viewer resets its terminal, then writes the next binary frame
 * (the snapshot, then live output). Sent on attach and after Restart pane.
 */
export const PaneResetFrame = z.object({ type: z.literal('reset') });
/** `exit` here does not close the socket: the pane stays, stopped, and Restart pane starts it again on the same socket. */
export const PaneServerFrame = z.discriminatedUnion('type', [TerminalExitFrame, TerminalSizeFrame, PaneStateFrame, PaneResetFrame]);
export type PaneServerFrame = z.infer<typeof PaneServerFrame>;

/** Close codes of the pane socket, beyond `TERMINAL_CLOSE`'s. */
export const PANE_CLOSE = {
  /** No such pane (the page does not reconnect). */
  notAvailable: 4404,
  /** Developer mode is off (the page does not reconnect; the server refuses every pane route and socket without it). */
  developerModeOff: 4403,
  /** The pane was closed (the page does not reconnect). */
  closed: 4001,
} as const;
