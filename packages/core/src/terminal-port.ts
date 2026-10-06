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

/** What a terminal pane is opened with (epic 16): a terminal that also mirrors its screen so a viewer can be given it again. */
export interface OpenPane extends OpenTerminal {
  /** Lines of scrollback the mirror keeps (default 5,000: about 20 MB at 120 columns, spike 16.1 finding 3). */
  scrollback?: number;
}

/**
 * A terminal pane's program (epic 16, spike 16.1 finding 12): a
 * {@link TerminalProcess} that mirrors its own screen in memory, so a viewer
 * that comes later (a reloaded tab, a second window) is given the screen as
 * it is now, not a raw tail of the output that a full-screen program breaks.
 * What it prints is the user's content: never log it, event it or store it.
 */
export interface PaneProcess extends TerminalProcess {
  /** The program's process id, for the pids Ogden recorded itself (never used to find a process by name). */
  readonly pid: number | undefined;
  /**
   * Subscribes a viewer: `onSnapshot` is called once with the screen as it is
   * (escape sequences that rebuild it in a terminal of the same size, scrollback
   * included), then `onData` with everything printed after, in order and with
   * none missed or repeated. Returns the unsubscribe. A pane that has exited
   * still gives its last screen.
   */
  attach(onSnapshot: (snapshot: string) => void, onData: (data: string) => void): () => void;
  /**
   * The last `count` non empty lines of what the screen shows now, after
   * everything printed so far has been read: for the status guess (story
   * 16.6), in memory only, never stored or logged.
   */
  screenLines(count: number): Promise<string[]>;
}

export interface TerminalPort {
  /** Whether {@link open} can work on this computer. */
  available(): Promise<TerminalAvailability>;
  /** Starts `file` with `args` in a new terminal. Rejects when it can't be started. */
  open(input: OpenTerminal): Promise<TerminalProcess>;
  /** Starts a terminal pane (epic 16). Without it, panes can't open. Rejects when it can't be started. */
  openPane?(input: OpenPane): Promise<PaneProcess>;
}
