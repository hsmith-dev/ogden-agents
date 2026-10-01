/**
 * `terminal-pty` (story 9.1; epic 3's terminal reuses it): runs a program in
 * a hidden pseudo-terminal through `node-pty`, which is loaded lazily and is
 * an optional dependency (AD-19). If it isn't installed or its native module
 * fails to load (Linux without build tools, say), {@link loadPty} answers
 * `{ ok: false, reason }` and the rest of Ogden Agents runs as usual.
 *
 * Nothing here logs what the program prints: its output goes only to the
 * caller's `onData` (a sign-in prints a URL and reads a code; AD-16).
 */
import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { killProcessTree, nodeProcessTreeSystem } from '../process-tree.js';

/** The module's package name. Kept in a variable so neither TypeScript nor the bundler needs it at build time (AD-19). */
const NODE_PTY = 'node-pty';

/** What {@link spawnHidden} needs of the pseudo-terminal (`node-pty`'s `IPty`). */
interface PtyTerminal {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number | undefined }) => void): unknown;
  write(data: string): void;
  resize?(cols: number, rows: number): void;
  kill(signal?: string): void;
  on?(event: 'error', listener: (error: unknown) => void): void;
}

/** What {@link spawnHidden} needs of the `node-pty` module. */
export interface PtyModule {
  spawn(
    file: string,
    args: readonly string[],
    options: { name?: string; cols: number; rows: number; cwd: string; env: Record<string, string>; useConpty?: boolean },
  ): PtyTerminal;
}

export interface HiddenPtyOptions {
  /** The whole environment of the program: nothing of this process's is added. */
  env: Readonly<Record<string, string>>;
  cwd: string;
  cols: number;
  rows: number;
}

/** A program running in a hidden pseudo-terminal. */
export interface HiddenPty {
  readonly pid: number;
  /** Everything the program prints (terminal escape sequences included). Never log it. */
  onData(listener: (data: string) => void): void;
  /** Called once when the program has exited; a listener added after that is called a moment later. */
  onExit(listener: (exit: { exitCode: number; signal: number | null }) => void): void;
  /** Types into the terminal. Ignored once the program has exited. */
  write(data: string): void;
  /** Resizes the terminal (story 3.1; every spawn has it). Ignored once the program has exited. */
  resize?(cols: number, rows: number): void;
  /**
   * Stops the program and everything it started. Safe to call more than
   * once. A program that exits by itself has what it started stopped as its
   * exit is reported (its process group, POSIX); a later call does nothing.
   */
  kill(): void;
}

/** Whether `node-pty` loaded: a way to start hidden terminals, or the plain reason it can't. */
export type PtyLoad =
  | {
      ok: true;
      spawnHidden(file: string, args: readonly string[], options: HiddenPtyOptions): HiddenPty;
      /** The error code (only) when making `spawn-helper` executable failed; spawns may then fail. For the log. */
      helperRepairFailed?: string;
    }
  /** `reason` is plain words for the UI; `detail` (the whole error) is for the log only. */
  | { ok: false; reason: string; detail: string };

export type PtyLoader = () => Promise<PtyLoad>;

/** The first line of an error's message, shortened, for the UI; the whole error goes to the log. */
export function plainLoadReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.split(/\r?\n/, 1)[0]?.trim() || 'the terminal module could not be loaded';
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

/**
 * node-pty 1.1.0's prebuilt `spawn-helper` (macOS) is published without its
 * execute bit, so every spawn fails with "posix_spawnp failed" until it has
 * one. Sets it on the helpers beside the loaded module, if they need it.
 */
function ensureSpawnHelperExecutable(packageDir: string): void {
  if (process.platform === 'win32') return;
  // A chmod that fails throws to the caller, which reports its code.
  for (const dir of ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`]) {
    const helper = join(packageDir, dir, 'spawn-helper');
    if (!existsSync(helper)) continue;
    try {
      accessSync(helper, constants.X_OK);
    } catch {
      chmodSync(helper, 0o755);
    }
  }
}

/**
 * node-pty 1.1.0's Windows `kill()` forks `conpty_console_list_agent` to list
 * and stop the console's processes. Once `taskkill` has stopped the tree that
 * agent can't attach to the console and prints an uncaught "AttachConsole
 * failed". The tree is already stopped, so its list is skipped; the rest of
 * `kill()` (closing the pseudo-console and its output worker) still runs. A
 * node-pty without that internal is left as it is.
 */
function skipConsoleProcessList(terminal: PtyTerminal): void {
  const agent = (terminal as { _agent?: { _getConsoleProcessList?: unknown } })._agent;
  if (agent !== undefined && agent !== null && typeof agent._getConsoleProcessList === 'function') {
    agent._getConsoleProcessList = () => Promise.resolve([]);
  }
}

/** Stops `terminal` and its whole process tree: its process group on POSIX, its console's processes on Windows. */
function killTerminalTree(terminal: PtyTerminal, platform: NodeJS.Platform): void {
  // The terminal's program leads its own session and process group (POSIX). The same
  // platform throughout, so a test that says `win32` never signals a real POSIX group.
  killProcessTree(terminal.pid, { ...nodeProcessTreeSystem, platform });
  if (platform === 'win32') {
    // Then the console; node-pty takes no signal on Windows. Its console list is
    // skipped only when taskkill ran (a valid pid) and stopped the tree.
    if (Number.isInteger(terminal.pid) && terminal.pid > 0) skipConsoleProcessList(terminal);
    try {
      terminal.kill();
    } catch {
      // Already gone.
    }
    return;
  }
  try {
    terminal.kill('SIGKILL');
  } catch {
    // Already gone.
  }
}

/** node-pty's Windows error when the pseudo-console it just made is missing from its own list (see {@link spawnWithRetry}). */
export const INVALID_PTY_HANDLE = 'Invalid pty handle';
/** How many times a spawn is tried when it fails with {@link INVALID_PTY_HANDLE}. */
export const PTY_SPAWN_ATTEMPTS = 3;

/**
 * node-pty 1.1.0 (Windows, ConPTY) keeps its open pseudo-consoles in a list
 * with no lock: a terminal's exit removes its entry on a background thread
 * while a new spawn adds one on the main thread. When the two meet (a
 * terminal opened just as another is closed or exits) the new entry can be
 * lost, and the spawn throws "Invalid pty handle" before anything has run.
 * That spawn is simply tried again, a bounded number of times; any other
 * error is thrown at once.
 */
function spawnWithRetry(spawn: () => PtyTerminal): PtyTerminal {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return spawn();
    } catch (error) {
      const lost = error instanceof Error && error.message === INVALID_PTY_HANDLE;
      if (!lost || attempt >= PTY_SPAWN_ATTEMPTS) throw error;
    }
  }
}

/** Wraps a loaded `node-pty` so every spawn has its error handlers attached and a tree kill. `platform` is replaced in tests only. */
export function hiddenPtySpawner(pty: PtyModule, platform: NodeJS.Platform = process.platform): Extract<PtyLoad, { ok: true }>['spawnHidden'] {
  return (file, args, options) => {
    const terminal = spawnWithRetry(() =>
      pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: { ...options.env },
      }),
    );
    let exit: { exitCode: number; signal: number | null } | undefined;
    let killed = false;
    let groupKilled = false;
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(exit: { exitCode: number; signal: number | null }) => void>();
    // An unhandled terminal error would crash the server; a closed terminal is reported through `onExit`.
    terminal.on?.('error', () => {});
    terminal.onData((data) => {
      for (const listener of dataListeners) listener(data);
    });
    terminal.onExit(({ exitCode, signal }) => {
      if (exit !== undefined) return;
      // What the program started may still run in its process group, which outlives it (story 3.4).
      // Stopped here, in the tick its exit is reported, while that group is still this program's;
      // never on a later `kill()`, when the id could be reused (review F2). Windows: nothing is done
      // here (story 3.8, decision Q2a). `taskkill /T` can't find a tree whose root has gone, and
      // neither closing the pseudo-console nor its console list stops what is left; a Node or Bun
      // CLI's children are in libuv's kill-on-close job and stop with it, so only a program started
      // outside that job (detached on purpose) outlives it. A live terminal's stop still runs
      // `taskkill /T` first (`killTerminalTree`).
      if (!groupKilled && platform !== 'win32') {
        groupKilled = true;
        killProcessTree(terminal.pid, { ...nodeProcessTreeSystem, platform });
      }
      exit = { exitCode, signal: signal === undefined || signal === 0 ? null : signal };
      const reported = exit;
      for (const listener of [...exitListeners]) listener(reported);
      exitListeners.clear();
    });
    return {
      pid: terminal.pid,
      onData: (listener) => void dataListeners.add(listener),
      onExit(listener) {
        // Once, as before: a listener added after the exit hears it a moment later (story 3.4).
        if (exit === undefined) exitListeners.add(listener);
        else {
          const reported = exit;
          setImmediate(() => listener(reported));
        }
      },
      write(data) {
        if (exit !== undefined || killed) return;
        try {
          terminal.write(data);
        } catch {
          // The program exited while this was typed; `onExit` reports it.
        }
      },
      resize(cols, rows) {
        if (exit !== undefined || killed) return;
        try {
          terminal.resize?.(cols, rows);
        } catch {
          // The program exited meanwhile; `onExit` reports it.
        }
      },
      kill() {
        if (killed) return;
        killed = true;
        // Once it has exited its group was stopped as it exited: nothing to do.
        if (exit !== undefined) return;
        groupKilled = true;
        killTerminalTree(terminal, platform);
      },
    };
  };
}

/**
 * A memoized lazy loader for `node-pty`. `importModule` is replaced in tests
 * (a loader that throws stands for a platform where it can't build).
 */
export function createPtyLoader(importModule: () => Promise<unknown> = () => import(NODE_PTY)): PtyLoader {
  let loading: Promise<PtyLoad> | undefined;
  return () =>
    (loading ??= (async (): Promise<PtyLoad> => {
      try {
        const loaded = (await importModule()) as { default?: PtyModule; spawn?: PtyModule['spawn'] };
        const pty = typeof loaded.spawn === 'function' ? (loaded as PtyModule) : loaded.default;
        if (pty === undefined || typeof pty.spawn !== 'function') return { ok: false, reason: 'the terminal module has no spawn function', detail: 'node-pty exports no spawn' };
        let packageDir: string | undefined;
        try {
          packageDir = dirname(createRequire(import.meta.url).resolve(`${NODE_PTY}/package.json`));
        } catch {
          // Not resolvable from here (an injected module): nothing to repair.
        }
        let helperRepairFailed: string | undefined;
        if (packageDir !== undefined) {
          try {
            ensureSpawnHelperExecutable(packageDir);
          } catch (error) {
            helperRepairFailed = String((error as NodeJS.ErrnoException).code ?? 'unknown');
          }
        }
        return { ok: true, spawnHidden: hiddenPtySpawner(pty), ...(helperRepairFailed === undefined ? {} : { helperRepairFailed }) };
      } catch (error) {
        return { ok: false, reason: plainLoadReason(error), detail: error instanceof Error ? (error.stack ?? error.message) : String(error) };
      }
    })());
}

/** The app's one `node-pty` loader: loads it on first use, once. */
export const loadPty: PtyLoader = createPtyLoader();
