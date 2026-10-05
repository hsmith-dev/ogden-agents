/**
 * The server's shell mode (story 13.3, E13-R3 and E13-R4): when the desktop app
 * starts the server it sets `OGDEN_AGENTS_SHELL=desktop`, and only then does the
 * server (a) keep an eye on its parent and exit when the parent is gone, (b)
 * accept the shell's update reports, and (c) tell the web UI it is inside the
 * app, so Welcome and the launch page use app wording (never "terminal" or
 * "npx"). Nothing else changes: the gate, the routes and the data folder are
 * the same as for `npx ogden-agents` (AD-15, AD-3).
 */

/** The variable only the app sets. */
export const SHELL_ENV = 'OGDEN_AGENTS_SHELL';

export type ShellMode = 'desktop';

/** `desktop` only for exactly that value; anything else (unset, empty, other text) is the npm route. */
export function shellModeOf(env: Readonly<Record<string, string | undefined>> = process.env): ShellMode | null {
  return env[SHELL_ENV] === 'desktop' ? 'desktop' : null;
}

/** What the parent watch listens to: a readable whose end means the parent closed its pipe or died. */
export interface ParentPipe {
  once(event: 'end' | 'close', listener: () => void): unknown;
  resume(): unknown;
}

/**
 * Calls `onGone` once when the pipe from the parent ends or closes. The app
 * keeps this server's standard input open for as long as it lives (the pipe
 * closes when the app exits or is killed, however it ends), so no server is
 * left running behind a shell that disappeared. Returns a function that stops
 * listening.
 */
export function watchParent(pipe: ParentPipe, onGone: () => void): void {
  let fired = false;
  const gone = (): void => {
    if (fired) return;
    fired = true;
    onGone();
  };
  pipe.once('end', gone);
  pipe.once('close', gone);
  // A paused stream never reports its end.
  pipe.resume();
}
