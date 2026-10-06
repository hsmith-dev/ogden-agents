/**
 * What a terminal socket's limits have in common, for a session's terminal
 * (`terminal-socket.ts`, stories 3.1 and 3.5) and a pane (`pane-socket.ts`,
 * epic 16): the close codes, how much a viewer may type and leave unsent, how
 * long it has to attach, how many viewers one terminal has, and the count of
 * them. Nothing here sees a frame's contents (AD-16).
 */
import { TERMINAL_CLOSE } from '@ogden-agents/shared';

export const WS_OPEN = 1;
/** The standard close code for a message too big to process. */
export const TOO_BIG = 1009;
/**
 * The most output a viewer may leave unsent before it is closed
 * ({@link TERMINAL_CLOSE}.slowViewer; story 3.1 review F2), so a stalled tab
 * never makes the server buffer a flooding CLI's output without bound. The
 * CLI is not paused: `ws` has no drain event and node-pty's pause is not
 * reliable on every platform, and one slow tab must not stall the others.
 */
export const MAX_VIEWER_BUFFERED_BYTES = 1024 * 1024;

/** The standard close code for a policy violation: here, typing faster than {@link INPUT_BYTES_PER_SECOND}. */
export const POLICY = 1008;
/** How long a new viewer has to send `attach` before it is attached at the terminal's current size (story 3.5). */
export const ATTACH_WAIT_MS = 5_000;
/** How much a viewer may type at once (a long paste) before its rate applies (story 3.5; 3.1 review F4). */
export const INPUT_BURST_BYTES = 4 * 1024 * 1024;
/** How fast a viewer's typing allowance refills. */
export const INPUT_BYTES_PER_SECOND = 1024 * 1024;
/** What each control frame (`attach`, `resize`, or one that fails its schema) costs from the same allowance (3.5 review F3), so resizing in a loop is limited too. */
export const CONTROL_FRAME_COST_BYTES = 1024;
/** The most viewers one session's terminal may have at once (3.5 review F2, coordinator decision). */
export const MAX_TERMINAL_VIEWERS = 8;
/**
 * The close code for a viewer over {@link MAX_TERMINAL_VIEWERS} (3.5 review
 * F2): `shared`'s `TERMINAL_CLOSE.tooManyViewers`, kept under this name for
 * its callers (story 3.9).
 */
export const TERMINAL_TOO_MANY_VIEWERS = TERMINAL_CLOSE.tooManyViewers;

/**
 * A token bucket of `burst` bytes refilled at `perSecond` (story 3.5): `take`
 * says whether `bytes` more fit, and spends them if they do.
 */
export function createInputBudget(burst: number, perSecond: number, now: () => number = Date.now) {
  let tokens = burst;
  let last = now();
  return {
    take(bytes: number): boolean {
      const time = now();
      tokens = Math.min(burst, tokens + (Math.max(0, time - last) * perSecond) / 1000);
      last = time;
      if (bytes > tokens) return false;
      tokens -= bytes;
      return true;
    },
  };
}

/** How many viewers each terminal has now, over every socket of one kind: `count` adds or removes one, `of` reads. */
export function createViewerCounter<Id>() {
  const counts = new Map<Id, number>();
  return {
    count(id: Id, change: 1 | -1) {
      const next = (counts.get(id) ?? 0) + change;
      if (next <= 0) counts.delete(id);
      else counts.set(id, next);
    },
    of: (id: Id): number => counts.get(id) ?? 0,
  };
}
