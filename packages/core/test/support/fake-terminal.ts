/**
 * Core's in-memory terminal for its tests (story 3.9; 3.4 review F5): one
 * fake for the handoff and viewer tests, in place of a copy in each. Core
 * depends on no adapter (AD-1), so it can't use `terminal-memory`; this one
 * takes the same options with the same meaning (`available`, `echo`,
 * `openError`, `exitOnKill`, `exitOnOpen`), keep the two in step, plus two
 * for the handoff's timing: `lateExitAtOnce` and `opening`.
 *
 * Each terminal it opens echoes what is typed into it (unless `echo` is
 * off), records every write and resize, and exits when the test says so or a
 * moment after it is killed.
 */
import type { OpenTerminal, TerminalAvailability, TerminalPort, TerminalProcess, TerminalSize } from '../../src/index.js';

/** One terminal the fake opened, with what the test can read and do. */
export interface FakeCli {
  /** What it was opened with. */
  input: OpenTerminal;
  /** Everything typed into it, in order. */
  writes: string[];
  /** Every resize, in order. */
  resizes: TerminalSize[];
  /** How many times it was killed. */
  kills: () => number;
  /** `undefined` while it runs; its exit code once it has exited (`null` when killed). */
  exitCode: () => number | null | undefined;
  /** Prints `text` as the program would. Ignored once it has exited. */
  print: (text: string) => void;
  /** The CLI exits by itself (`/exit`, a crash). Ignored once it has exited. */
  exit: (code: number | null) => void;
}

export interface FakeTerminalOptions {
  /** Default `{ ok: true }`; while it is not `ok`, `open` rejects with its reason. */
  available?: TerminalAvailability;
  /** Whether typed text is printed back. Default `true`. */
  echo?: boolean;
  /** When set, `open` rejects with it (the CLI couldn't be spawned). */
  openError?: Error;
  /** Whether a killed terminal reports its exit. Default `true`; `false` is a CLI that ignores the kill. */
  exitOnKill?: boolean;
  /** When set, each terminal exits by itself with this code as it opens (a CLI that crashes on start). */
  exitOnOpen?: number;
  /** An exit that already happened is reported to a later `onExit` at once, not a moment later. Default `false`. */
  lateExitAtOnce?: boolean;
  /** Awaited at the start of each `open` (a slow spawn). */
  opening?: () => Promise<void>;
}

export function fakeTerminal({
  available = { ok: true },
  echo = true,
  openError,
  exitOnKill = true,
  exitOnOpen,
  lateExitAtOnce = false,
  opening,
}: FakeTerminalOptions = {}) {
  const processes: FakeCli[] = [];
  const port: TerminalPort = {
    available: async () => available,
    async open(input) {
      await opening?.();
      if (!available.ok) throw new Error(available.reason);
      if (openError !== undefined) throw openError;
      const data = new Set<(data: string) => void>();
      const exits: Array<(exit: { exitCode: number | null }) => void> = [];
      const writes: string[] = [];
      const resizes: TerminalSize[] = [];
      let exitCode: number | null | undefined;
      let kills = 0;
      const emit = (text: string) => {
        if (exitCode !== undefined) return;
        for (const listener of [...data]) listener(text);
      };
      const exit = (code: number | null) => {
        if (exitCode !== undefined) return;
        exitCode = code;
        data.clear();
        for (const listener of exits.splice(0)) listener({ exitCode: code });
      };
      const cli: TerminalProcess = {
        onData(listener) {
          if (exitCode !== undefined) return () => undefined;
          data.add(listener);
          return () => void data.delete(listener);
        },
        onExit(listener) {
          if (exitCode === undefined) exits.push(listener);
          else {
            const code = exitCode;
            // A port may report an exit that already happened at once, or a moment later.
            if (lateExitAtOnce) listener({ exitCode: code });
            else setImmediate(() => listener({ exitCode: code }));
          }
        },
        write(text) {
          if (exitCode !== undefined) return;
          writes.push(text);
          if (echo) emit(text);
        },
        resize(cols, rows) {
          if (exitCode === undefined) resizes.push({ cols, rows });
        },
        kill() {
          kills++;
          // A killed program reports its exit a moment later, as a real one does (unless told to ignore it).
          if (exitOnKill) setImmediate(() => exit(null));
        },
      };
      processes.push({ input, writes, resizes, kills: () => kills, exitCode: () => exitCode, print: emit, exit });
      if (exitOnOpen !== undefined) exit(exitOnOpen);
      return cli;
    },
  };
  return { port, processes };
}
