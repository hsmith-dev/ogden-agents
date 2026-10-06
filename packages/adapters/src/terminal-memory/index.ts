/**
 * `terminal-memory` (story 3.2): an in-memory `TerminalPort` for tests, never
 * wired into the server. Each terminal it opens echoes what is typed into
 * it, records every write and resize, and exits when the test says so
 * ({@link MemoryTerminalProcess.exit}) or when it is killed. Whether a
 * terminal can be opened is switchable ({@link MemoryTerminalPort.setAvailable}),
 * as when `node-pty` fails to load (AD-19). Story 3.4's failure modes: an
 * `open` that rejects, a CLI that ignores its kill, and one that crashes as
 * it starts.
 */
import type { OpenPane, OpenTerminal, PaneProcess, TerminalAvailability, TerminalPort, TerminalProcess } from '@ogden-agents/core';

/** One terminal the memory port opened, with what the test can read and do. */
export interface MemoryTerminalProcess extends TerminalProcess {
  /** What it was opened with. */
  readonly input: OpenTerminal;
  /** Everything typed into it, in order. */
  readonly writes: readonly string[];
  /** Every resize, in order. */
  readonly resizes: ReadonlyArray<{ cols: number; rows: number }>;
  /** How many times it was killed. */
  readonly kills: number;
  /** `undefined` while it runs; its exit code once it has exited (`null` when killed). */
  readonly exitCode: number | null | undefined;
  /** Prints `text` as the program would. Ignored once it has exited. */
  print(text: string): void;
  /** The program exits by itself with `code` (`/exit`, a crash). Ignored once it has exited. */
  exit(code: number): void;
}

export interface MemoryTerminalPort extends TerminalPort {
  /** Every terminal opened, oldest first. */
  readonly opened: readonly MemoryTerminalProcess[];
  /** What {@link TerminalPort.available} answers from now on; while it is not `ok`, `open` rejects with its reason. */
  setAvailable(availability: TerminalAvailability): void;
}

export interface MemoryTerminalOptions {
  /** Default `{ ok: true }`. */
  available?: TerminalAvailability;
  /** Whether typed text is printed back, as a terminal with echo on does. Default `true`. */
  echo?: boolean;
  /** When set, `open` rejects with it while available (the CLI couldn't be spawned). */
  openError?: Error;
  /** Whether a killed terminal reports its exit. Default `true`; `false` is a CLI that ignores the kill. */
  exitOnKill?: boolean;
  /** When set, each terminal exits by itself with this code as it opens (a CLI that crashes on start). */
  exitOnOpen?: number;
}

export function createMemoryTerminalPort(options: MemoryTerminalOptions = {}): MemoryTerminalPort {
  let availability: TerminalAvailability = options.available ?? { ok: true };
  const echo = options.echo ?? true;
  const exitOnKill = options.exitOnKill ?? true;
  const opened: MemoryTerminalProcess[] = [];

  const openOne = (input: OpenTerminal): MemoryTerminalProcess => {
    const data = new Set<(data: string) => void>();
    const exits: Array<(exit: { exitCode: number | null }) => void> = [];
    const writes: string[] = [];
    const resizes: Array<{ cols: number; rows: number }> = [];
    let kills = 0;
    let exitCode: number | null | undefined;
    const emit = (text: string) => {
      for (const listener of [...data]) listener(text);
    };
    const finish = (code: number | null) => {
      if (exitCode !== undefined) return;
      exitCode = code;
      data.clear();
      for (const listener of exits.splice(0)) listener({ exitCode: code });
    };
    return {
      input,
      writes,
      resizes,
      get kills() {
        return kills;
      },
      get exitCode() {
        return exitCode;
      },
      onData(listener) {
        if (exitCode !== undefined) return () => undefined;
        data.add(listener);
        return () => void data.delete(listener);
      },
      onExit(listener) {
        // Once, as a real terminal reports it: later if it has already exited.
        if (exitCode === undefined) exits.push(listener);
        else {
          const code = exitCode;
          setImmediate(() => listener({ exitCode: code }));
        }
      },
      write(text) {
        if (exitCode !== undefined) return;
        writes.push(text);
        if (echo) emit(text);
      },
      resize(cols, rows) {
        if (exitCode !== undefined) return;
        resizes.push({ cols, rows });
      },
      kill() {
        kills++;
        // A killed program reports its exit a moment later, as a real one does (unless told to ignore it).
        if (exitOnKill) setImmediate(() => finish(null));
      },
      print(text) {
        if (exitCode === undefined) emit(text);
      },
      exit: (code) => finish(code),
    };
  };

  return {
    opened,
    setAvailable(next) {
      availability = next;
    },
    available: async () => availability,
    async openPane(input: OpenPane): Promise<PaneProcess> {
      const process = await this.open(input);
      let printed = '';
      process.onData((text) => (printed += text));
      return {
        ...process,
        pid: undefined,
        // No screen to serialize: the snapshot is what was printed so far.
        attach(onSnapshot, onData) {
          onSnapshot(printed);
          return process.onData(onData);
        },
      };
    },
    async open(input) {
      if (!availability.ok) throw new Error(availability.reason);
      if (options.openError !== undefined) throw options.openError;
      const terminal = openOne(input);
      opened.push(terminal);
      if (options.exitOnOpen !== undefined) terminal.exit(options.exitOnOpen);
      return terminal;
    },
  };
}
