/**
 * Stopping a process and everything it started (story 9.6: the one copy the
 * launcher, the Claude Code adapter and `terminal-pty` share). Exported on
 * its own (`@ogden-agents/adapters/process-tree`) so the launcher doesn't
 * load the adapters index.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { helperEnvironment } from './child-env.js';

/** What {@link killProcessTree} needs of the system; replaced in tests. */
export interface ProcessTreeSystem {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** Runs a program to completion (`taskkill` on Windows). */
  run(file: string, args: readonly string[]): void;
  /** `SIGKILL`s the process group `pid` leads; throws when there is none. */
  killGroup(pid: number): void;
}

/** This process's system. Spread it to replace one part (`{ ...nodeProcessTreeSystem, platform }`). */
export const nodeProcessTreeSystem: ProcessTreeSystem = {
  get platform() {
    return process.platform;
  },
  get env() {
    return process.env;
  },
  // The base allowlist only (AD-16): taskkill never sees an agent key.
  run: (file, args) => void spawnSync(file, args, { windowsHide: true, stdio: 'ignore', env: helperEnvironment() }),
  killGroup: (pid) => void process.kill(-pid, 'SIGKILL'),
};

/** `taskkill.exe` by absolute path, so no `PATH` entry can stand in for it. */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe');
}

/**
 * Stops `pid` and its whole tree: on Windows `taskkill /T /F` (by absolute
 * path), on POSIX a `SIGKILL` to its process group (the process must lead
 * one: spawned `detached`, or a pseudo-terminal's session). Does nothing
 * unless `pid` is a positive integer: `-0` or a bad pid would signal this
 * process's own group. A tree that is already gone is not an error.
 */
export function killProcessTree(pid: number | undefined, system: ProcessTreeSystem = nodeProcessTreeSystem): void {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return;
  if (system.platform === 'win32') {
    try {
      system.run(taskkillPath(system.env), ['/pid', String(pid), '/T', '/F']);
    } catch {
      // Nothing to stop, or taskkill couldn't run: as if already gone.
    }
    return;
  }
  try {
    system.killGroup(pid);
  } catch {
    // The group is already gone.
  }
}
