import { z } from 'zod';
import { SessionDriver } from './entities.js';

/**
 * The terminal contract (story 3.1, CAP-5; frozen by story 3.2): switching a
 * session's driver over REST, whether its terminal can work
 * ({@link SessionTerminal}), why the driver changed ({@link DriverChangeCause}),
 * and the control frames of the terminal socket (`TERMINAL_SOCKET_ROUTE`).
 *
 * Terminal bytes travel only as binary frames on that socket; its text frames
 * are JSON control frames only. Bytes are never evented, stored or logged:
 * the event log gets only `session.driver_changed` and the messages imported
 * after switching back (AD-6, AD-16).
 */

/** `POST /api/v1/workspaces/:wsId/sessions/:sesId/driver` → `SessionResponse`. */
export const SetDriverRequest = z.object({ driver: SessionDriver });
export type SetDriverRequest = z.infer<typeof SetDriverRequest>;

/** The largest binary frame (typed or pasted bytes) the server takes; a larger one closes the socket (1009). */
export const MAX_TERMINAL_INPUT_BYTES = 1024 * 1024;

/** The largest text (control) frame the server takes; a larger one closes the socket (1009). */
export const MAX_TERMINAL_CONTROL_BYTES = 1024;

/** The terminal sizes a resize may ask for. */
export const MAX_TERMINAL_COLS = 1000;
export const MAX_TERMINAL_ROWS = 500;

/**
 * Why a session's terminal can't work here, for the toggle's disabled reason
 * (E3-R7). Not being `idle` is not one of them: the UI reads that from the
 * session's state (E3-R5).
 * - `agent_unsupported`: the agent's sessions can't be resumed in its own CLI.
 * - `no_agent_session`: the chat has never reached its agent, so there is nothing to resume.
 * - `pty_unavailable`: `node-pty` failed to load on this computer (AD-19).
 * - `cli_not_found`: the agent's CLI could not be found.
 */
export const TerminalUnavailableCode = z.enum(['agent_unsupported', 'no_agent_session', 'pty_unavailable', 'cli_not_found']);
export type TerminalUnavailableCode = z.infer<typeof TerminalUnavailableCode>;

/**
 * Whether the session's terminal can work (story 3.2; filled in by 3.7). On
 * `GET` session (`SessionResponse.terminal`) and in a 409
 * `terminal_unavailable`'s `details.terminal`. `reason` is plain words for the
 * user: never a path, a command line or a secret.
 */
export const SessionTerminal = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true) }),
  z.object({ available: z.literal(false), code: TerminalUnavailableCode, reason: z.string().min(1) }),
]);
export type SessionTerminal = z.infer<typeof SessionTerminal>;

/**
 * Why `session.driver_changed` happened: the user switched (`user`), the CLI
 * exited by itself (`cli_exited`: `/exit`, a crash), the server stopped with
 * the terminal driving (`server_stopped`), or a server start found a session
 * a stopped server had left in the terminal (`server_restarted`).
 */
export const DriverChangeCause = z.enum(['user', 'cli_exited', 'server_stopped', 'server_restarted']);
export type DriverChangeCause = z.infer<typeof DriverChangeCause>;

const terminalSize = {
  cols: z.number().int().min(1).max(MAX_TERMINAL_COLS),
  rows: z.number().int().min(1).max(MAX_TERMINAL_ROWS),
};

/** Client → server: the viewer's terminal size changed. */
export const TerminalResizeFrame = z.object({ type: z.literal('resize'), ...terminalSize });
/**
 * Client → server: the viewer's first frame once the socket is open, with its
 * size (story 3.5 orders reattaching around it; until then it is a resize).
 */
export const TerminalAttachFrame = z.object({ type: z.literal('attach'), ...terminalSize });
export const TerminalClientFrame = z.discriminatedUnion('type', [TerminalAttachFrame, TerminalResizeFrame]);
export type TerminalClientFrame = z.infer<typeof TerminalClientFrame>;

/**
 * Server → client: the terminal ended. `exitCode` is the CLI's own when it
 * exited by itself, `null` when it was stopped (switched back, server stop).
 * The socket closes right after.
 */
export const TerminalExitFrame = z.object({ type: z.literal('exit'), exitCode: z.number().int().nullable() });
/**
 * Server → client: the terminal's size now, after another viewer resized it
 * (the size follows whichever viewer typed or resized last; story 3.5 sends it).
 */
export const TerminalSizeFrame = z.object({ type: z.literal('size'), ...terminalSize });
export const TerminalServerFrame = z.discriminatedUnion('type', [TerminalExitFrame, TerminalSizeFrame]);
export type TerminalServerFrame = z.infer<typeof TerminalServerFrame>;

/** Close codes of the terminal socket, beyond the standard ones. */
export const TERMINAL_CLOSE = {
  /** The session is unknown, or the terminal does not drive it. */
  notTerminal: 4404,
  /** The terminal ended (see the `exit` frame before it). */
  ended: 4000,
  /**
   * This viewer fell more than a megabyte behind the terminal's output
   * (1013, try again later): it reconnects and gets the recent output again
   * (story 3.1 review F2). The terminal runs on.
   */
  slowViewer: 1013,
  /**
   * A viewer over the session's limit of viewers (8; 3.5 review F2): the
   * panel says so and does not reconnect. The terminal and its other viewers
   * go on (story 3.9 moved it here from the server and the panel).
   */
  tooManyViewers: 4429,
} as const;
