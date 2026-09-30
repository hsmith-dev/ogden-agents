import { z } from 'zod';
import { SessionDriver } from './entities.js';

/**
 * The terminal contract (story 3.1, CAP-5; entry 2 freezes it): switching a
 * session's driver over REST, and the control frames of the terminal socket
 * (`TERMINAL_SOCKET_ROUTE`). Terminal bytes travel only as binary frames on
 * that socket: they are never evented, stored or logged (AD-6, AD-16).
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

/** Client → server: the viewer's terminal size. */
export const TerminalResizeFrame = z.object({
  type: z.literal('resize'),
  cols: z.number().int().min(1).max(MAX_TERMINAL_COLS),
  rows: z.number().int().min(1).max(MAX_TERMINAL_ROWS),
});
export const TerminalClientFrame = z.discriminatedUnion('type', [TerminalResizeFrame]);
export type TerminalClientFrame = z.infer<typeof TerminalClientFrame>;

/**
 * Server → client: the terminal ended. `exitCode` is the CLI's own when it
 * exited by itself, `null` when it was stopped (switched back, server stop).
 * The socket closes right after.
 */
export const TerminalExitFrame = z.object({ type: z.literal('exit'), exitCode: z.number().int().nullable() });
export const TerminalServerFrame = z.discriminatedUnion('type', [TerminalExitFrame]);
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
} as const;
