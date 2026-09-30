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
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The module's package name. Kept in a variable so neither TypeScript nor the bundler needs it at build time (AD-19). */
const NODE_PTY = 'node-pty';

/** What {@link spawnHidden} needs of the pseudo-terminal (`node-pty`'s `IPty`). */
interface PtyTerminal {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number | undefined }) => void): unknown;
  write(data: string): void;
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
  /** Called once when the program has exited. */
  onExit(listener: (exit: { exitCode: number; signal: number | null }) => void): void;
  /** Types into the terminal. Ignored once the program has exited. */
  write(data: string): void;
  /** Stops the program and everything it started. Safe to call more than once. */
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

/** `taskkill.exe` by absolute path, so no `PATH` entry can stand in for it. */
function taskkillPath(): string {
  return join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe');
}

/** Stops `terminal` and its whole process tree: its process group on POSIX, its console's processes on Windows. */
function killTree(terminal: PtyTerminal): void {
  const pid = terminal.pid;
  const validPid = Number.isInteger(pid) && pid > 0;
  if (process.platform === 'win32') {
    // The whole tree, then the console; node-pty takes no signal on Windows.
    if (validPid) spawnSync(taskkillPath(), ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    try {
      terminal.kill();
    } catch {
      // Already gone.
    }
    return;
  }
  // The terminal's program leads its own session and process group. Never `-0` or a
  // bad pid, which would signal this process's own group.
  if (validPid) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // The group is already gone.
    }
  }
  try {
    terminal.kill('SIGKILL');
  } catch {
    // Already gone.
  }
}

/** Wraps a loaded `node-pty` so every spawn has its error handlers attached and a tree kill. */
export function hiddenPtySpawner(pty: PtyModule): Extract<PtyLoad, { ok: true }>['spawnHidden'] {
  return (file, args, options) => {
    const terminal = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: { ...options.env },
    });
    let exited = false;
    let killed = false;
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(exit: { exitCode: number; signal: number | null }) => void>();
    // An unhandled terminal error would crash the server; a closed terminal is reported through `onExit`.
    terminal.on?.('error', () => {});
    terminal.onData((data) => {
      for (const listener of dataListeners) listener(data);
    });
    terminal.onExit(({ exitCode, signal }) => {
      if (exited) return;
      exited = true;
      for (const listener of exitListeners) listener({ exitCode, signal: signal === undefined || signal === 0 ? null : signal });
    });
    return {
      pid: terminal.pid,
      onData: (listener) => void dataListeners.add(listener),
      onExit: (listener) => void exitListeners.add(listener),
      write(data) {
        if (exited || killed) return;
        try {
          terminal.write(data);
        } catch {
          // The program exited while this was typed; `onExit` reports it.
        }
      },
      kill() {
        if (killed) return;
        killed = true;
        if (!exited) killTree(terminal);
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
