/**
 * The port for an agent's own terminal (AD-1, AD-6; story 3.1, completed by
 * entry 2): runs a program, such as `claude --resume <id>`, in a
 * pseudo-terminal the server owns. Core names no terminal library here; the
 * `terminal-pty` adapter does.
 *
 * What the program prints and what the user types are the user's content:
 * they are never logged, evented, stored or put in diagnostics (AD-16).
 */

/** The program to run: a file and its arguments, never a shell command line. */
export interface TerminalCommand {
  file: string;
  args: readonly string[];
}

export interface OpenTerminal extends TerminalCommand {
  /** The folder the program starts in. */
  cwd: string;
  /** The program's whole environment: nothing of the server's own is added. */
  env: Readonly<Record<string, string>>;
  cols: number;
  rows: number;
}

/** A program running in a terminal. */
export interface TerminalProcess {
  /** Everything the program prints, escape sequences included. Returns the unsubscribe. Never log it. */
  onData(listener: (data: string) => void): () => void;
  /** Called once when the program has exited (killed included). */
  onExit(listener: (exit: { exitCode: number | null }) => void): void;
  /** Types into the terminal. Ignored once the program has exited. */
  write(data: string): void;
  /** Resizes the terminal. Ignored once the program has exited. */
  resize(cols: number, rows: number): void;
  /** Stops the program and everything it started. Safe to call more than once. */
  kill(): void;
}

/** Whether a terminal can be opened here, or the plain reason it can't (AD-19: `node-pty` failed to load). */
export type TerminalAvailability = { ok: true } | { ok: false; reason: string };

export interface TerminalPort {
  /** Whether {@link open} can work on this computer. */
  available(): Promise<TerminalAvailability>;
  /** Starts `file` with `args` in a new terminal. Rejects when it can't be started. */
  open(input: OpenTerminal): Promise<TerminalProcess>;
}
