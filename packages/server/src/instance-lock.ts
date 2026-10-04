/**
 * One server per data folder (story 1.7): `start()` takes `<dataDir>/server.lock`
 * before it opens anything, and a second server on the same folder refuses to
 * start. The lock names its owner's pid; a lock whose pid is gone is stale
 * (the owner crashed) and is taken over.
 */
import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = 'server.lock';

/**
 * The background server's exit code when another server already holds the
 * data folder; the launcher that spawned it then attaches to that one.
 */
export const EXIT_ALREADY_RUNNING = 3;

/** Thrown by `start()` when another live server holds the data folder. */
export class ServerAlreadyRunningError extends Error {
  override readonly name = 'ServerAlreadyRunningError';
  readonly code = 'already_running';
  constructor(readonly pid: number) {
    super(`another Ogden Agents server (pid ${pid}) is already running on this data folder`);
  }
}

export interface InstanceLock {
  /** Removes the lock if it is still ours. Safe to call twice. */
  release(): void;
}

/** Whether a process with this pid exists (EPERM: it exists but isn't ours to signal). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(file: string): { text: string; pid: number | undefined } | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const pid = (JSON.parse(text) as { pid?: unknown }).pid;
    return { text, pid: Number.isInteger(pid) ? (pid as number) : undefined };
  } catch {
    return { text, pid: undefined };
  }
}

/**
 * Takes the data folder's lock, or throws {@link ServerAlreadyRunningError}.
 * The lock file appears complete in one step (written aside, then linked), so
 * of two servers starting together exactly one wins.
 */
export function acquireInstanceLock(dataDir: string): InstanceLock {
  const file = join(dataDir, LOCK_FILE);
  const content = JSON.stringify({ pid: process.pid, nonce: randomBytes(8).toString('hex') });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        linkSync(temp, file);
        let released = false;
        return {
          release() {
            if (released) return;
            released = true;
            if (readLock(file)?.text === content) rmSync(file, { force: true });
          },
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const holder = readLock(file);
      if (holder === undefined) continue; // Released in the meantime.
      if (holder.pid !== undefined && isPidAlive(holder.pid)) throw new ServerAlreadyRunningError(holder.pid);
      // Stale (its owner is gone, or it is unreadable): remove it unless it changed meanwhile, then retry.
      if (readLock(file)?.text === holder.text) rmSync(file, { force: true });
    }
    const holder = readLock(file);
    throw new ServerAlreadyRunningError(holder?.pid ?? -1);
  } finally {
    rmSync(temp, { force: true });
  }
}
