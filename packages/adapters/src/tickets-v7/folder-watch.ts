/**
 * A bounded watcher of one folder tree (story 4.8), for `tickets-v7`'s
 * `watch`. It never names BMad: it tells `onSettled` that a file under the
 * root changed, once a burst of changes has settled.
 *
 * What the CI probe found (story 4.8's plan, Design Notes) shapes it:
 * recursive `fs.watch` loses a deleted-and-recreated subfolder on Linux and
 * goes silent when the root is recreated, Windows storms events on a removed
 * root and collapses bursts to a `null` filename, a UNC path throws, and
 * events fire mid-write. So:
 *
 * - One non-recursive `fs.watch` per folder, which this module arms and
 *   closes itself, each with an `error` handler; on Windows one recursive
 *   watcher on the root instead (see {@link RECURSIVE_BY_DEFAULT}). Filenames are only hints
 *   (a named subfolder is re-armed); the truth is a stat fingerprint.
 * - A scan (`lstat` only, never following a link) builds the fingerprint
 *   (each file's path, size, mtime, ctime and inode) and the folder set. It
 *   skips symlinks, `.git` and any folder holding a `.git` entry (a worktree
 *   or a nested repo): those are neither watched nor fingerprinted, so
 *   writes there never reach `onSettled`. Nothing outside the root is read.
 * - Raw events are debounced (300 ms trailing, 1 s max wait); one scan runs
 *   at a time, and a change during it schedules one more. `onSettled` runs
 *   only when the fingerprint changed.
 * - After each scan the watchers are reconciled with the folder set: gone
 *   folders closed, new ones armed, a folder whose identity (device, inode,
 *   birth time) changed or that an event named is re-armed. A watcher may
 *   miss what happens while the OS starts it (macOS), so arming any runs
 *   one confirming scan `confirmMs` later.
 * - Bounded: at most `maxDirs` folder watchers and `maxScanEntries` entries
 *   per scan. Past either it polls the fingerprint slowly (`capPollMs`,
 *   re-checking the caps each time). When `fs.watch` throws or a watcher
 *   fails with no room (`ENOSPC`/`EMFILE`/`ENFILE`), as unsupported, or with
 *   `UNKNOWN` arming the root the first time (a UNC path), or fails too
 *   often in a row, it polls (`pollMs`) for the rest of its life. Any other
 *   failure (a folder removed meanwhile) closes that watcher and rescans. A watcher with more than `floodLimit` events
 *   between two scans is closed; the next scan re-arms it.
 * - A missing root (or one that is no longer a folder, or no longer its own
 *   real path: a parent swapped for a link) closes every watcher and polls
 *   until it is back, then arms again. The root may be missing at start.
 * - `close()` is idempotent and stops every timer and watcher; nothing fires
 *   after it.
 */
import { createHash } from 'node:crypto';
import { watch as fsWatch, type BigIntStats, type Dirent } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** At most this many folder watchers per watch (plan: `MAX_WATCHED_DIRS`). */
export const MAX_WATCHED_DIRS = 500;
/** At most this many entries per scan (plan: `MAX_SCAN_ENTRIES`). */
export const MAX_SCAN_ENTRIES = 20_000;

export interface FolderWatchTiming {
  /** Trailing debounce after the last raw event. */
  debounceMs: number;
  /** The longest a burst may delay a scan. */
  maxWaitMs: number;
  /** The fingerprint poll interval in polling mode (a missing root, a watcher failure). */
  pollMs: number;
  /** The slower poll interval while the tree is over `maxDirs` or `maxScanEntries`. */
  capPollMs: number;
  /** The confirming scan after arming a watcher. */
  confirmMs: number;
  maxDirs: number;
  maxScanEntries: number;
  /** Raw events one watcher may report between two scans before it is closed. */
  floodLimit: number;
}

export const DEFAULT_FOLDER_WATCH_TIMING: Readonly<FolderWatchTiming> = {
  debounceMs: 300,
  maxWaitMs: 1000,
  pollMs: 2000,
  capPollMs: 10_000,
  confirmMs: 700,
  maxDirs: MAX_WATCHED_DIRS,
  maxScanEntries: MAX_SCAN_ENTRIES,
  floodLimit: 1000,
};

/** What a folder watcher must offer: `fs.watch`'s `FSWatcher` does. */
export interface DirWatcher {
  close(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Watches one folder (default: `fs.watch`), non-recursively, or with
 * `recursive` its whole tree; tests inject one to count open watchers.
 */
export type WatchDir = (dir: string, listener: (eventType: string, filename: string | Buffer | null) => void, recursive?: boolean) => DirWatcher;

export const defaultWatchDir: WatchDir = (dir, listener, recursive = false) => fsWatch(dir, { persistent: false, recursive }, listener);

/**
 * Whether one recursive watcher on the root replaces the per-folder ones:
 * on Windows, where an open handle on a folder makes the OS refuse to rename
 * or move any folder above it (EPERM), so per-folder watchers would stop the
 * user, git or an agent renaming an epic folder that has subfolders. One
 * handle on the root (ReadDirectoryChangesW over the tree) blocks only the
 * root's own parents, which every watcher of the root does. The probe showed
 * Windows' recursive watch keeps up with recreated subfolders and follows no
 * link out; its `null`-named bursts are only hints here anyway.
 */
export const RECURSIVE_BY_DEFAULT = process.platform === 'win32';

export interface FolderWatchState {
  mode: 'watch' | 'poll';
  /** Folder watchers open now. */
  watchers: number;
  /** Timers pending now (the debounce and the poll). */
  timers: number;
  /** Whether a change is being debounced or scanned, or a confirming scan is due. */
  pending: boolean;
  closed: boolean;
}

export interface FolderWatch {
  /** Stops every watcher and timer; safe to call more than once. */
  close(): void;
  state(): FolderWatchState;
}

export interface FolderWatchOptions {
  /**
   * The folder to watch: an absolute path the caller has already contained,
   * which is its own real path once it exists (each scan checks it again and
   * treats a root that resolves anywhere else as missing). It may not exist
   * yet: the watch then polls until it appears.
   */
  root: string;
  /** Called once a change has settled and the fingerprint differs. Never after `close()`. */
  onSettled: () => void;
  timing?: Partial<FolderWatchTiming> | undefined;
  watchDir?: WatchDir | undefined;
  /** Told, with a code, when the watch falls back to polling for good. */
  onFallback?: ((reason: string) => void) | undefined;
  /** One recursive watcher on the root instead of one per folder (default {@link RECURSIVE_BY_DEFAULT}). */
  recursive?: boolean | undefined;
}

/** The fingerprint of a missing root. */
const MISSING = 'missing';
/** Errors after which a watcher can't be re-armed usefully (no room, or not supported): poll instead. */
const FATAL_CODES = new Set(['ENOSPC', 'EMFILE', 'ENFILE', 'ENOSYS', 'ENOTSUP', 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM']);
/** Watcher errors in a row (each followed by a rescan; a clean scan resets the count) before polling for good. */
const MAX_WATCHER_ERRORS = 20;

type ScanResult = { missing: true } | { missing: false; fingerprint: string; dirs: Map<string, string>; overflow: boolean };

const identityOf = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
const codeOf = (error: unknown): string => (typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : 'unknown');
const byName = (a: Dirent, b: Dirent) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Scans `root` (see the header) within `maxEntries`. */
async function scanTree(root: string, maxEntries: number): Promise<ScanResult> {
  let rootStat: BigIntStats;
  try {
    rootStat = await lstat(root, { bigint: true });
  } catch {
    return { missing: true };
  }
  if (!rootStat.isDirectory()) return { missing: true };
  // A parent swapped for a link since the watch started: never followed.
  try {
    if ((await realpath(root)) !== root) return { missing: true };
  } catch {
    return { missing: true };
  }
  const hash = createHash('sha256');
  const dirs = new Map<string, string>([[root, identityOf(rootStat)]]);
  const queue: string[] = [root];
  let entries = 0;
  let overflow = false;
  while (queue.length > 0 && !overflow) {
    const dir = queue.shift()!;
    let listed: Dirent[];
    try {
      listed = await readdir(dir, { withFileTypes: true });
    } catch {
      if (dir === root) return { missing: true };
      dirs.delete(dir);
      continue;
    }
    // A worktree or nested repo below the root: neither watched nor fingerprinted.
    if (dir !== root && listed.some((entry) => entry.name === '.git')) {
      dirs.delete(dir);
      continue;
    }
    const kept: Dirent[] = [];
    for (const entry of listed.sort(byName)) {
      if (entry.name === '.git' || entry.isSymbolicLink()) continue;
      if (++entries > maxEntries) {
        overflow = true;
        break;
      }
      kept.push(entry);
    }
    const stats = await Promise.all(
      kept.map(async (entry) => {
        const full = join(dir, entry.name);
        try {
          return { full, stat: await lstat(full, { bigint: true }) };
        } catch {
          return undefined;
        }
      }),
    );
    for (const each of stats) {
      if (each === undefined || each.stat.isSymbolicLink()) continue;
      if (each.stat.isDirectory()) {
        dirs.set(each.full, identityOf(each.stat));
        queue.push(each.full);
      } else if (each.stat.isFile()) {
        const { size, mtimeNs, ctimeNs, ino } = each.stat;
        hash.update(`${relative(root, each.full)}\0${size}\0${mtimeNs}\0${ctimeNs}\0${ino}\n`);
      }
    }
  }
  // Folders queued past the cap were never listed: not watched either.
  for (const dir of queue) dirs.delete(dir);
  return { missing: false, fingerprint: hash.digest('hex'), dirs, overflow };
}

/** Starts watching `root`; resolves once the first scan has armed it (or chosen to poll). */
export async function startFolderWatch({ root, onSettled, timing = {}, watchDir = defaultWatchDir, onFallback, recursive = RECURSIVE_BY_DEFAULT }: FolderWatchOptions): Promise<FolderWatch> {
  const config: FolderWatchTiming = { ...DEFAULT_FOLDER_WATCH_TIMING, ...timing };
  interface Armed {
    identity: string;
    watcher: DirWatcher;
    events: number;
  }
  const watchers = new Map<string, Armed>();
  /** Paths an event named since the last scan: a folder among them is re-armed. */
  const hinted = new Set<string>();
  let closed = false;
  /** Polling for good: a watcher failure or `fs.watch` throwing. */
  let sticky = false;
  let watcherErrors = 0;
  let fingerprint: string | undefined;
  let trailing: NodeJS.Timeout | undefined;
  let firstEventAt: number | undefined;
  let poll: NodeJS.Timeout | undefined;
  let pollEvery: number | undefined;
  /** Whether the root has had a watcher yet (`UNKNOWN` arming it the first time is a UNC path: poll for good). */
  let rootArmed = false;
  /** The confirming scan after arming a watcher. */
  let confirm: NodeJS.Timeout | undefined;
  let scanning = false;
  let rescan = false;

  const closeWatcher = (dir: string) => {
    const armed = watchers.get(dir);
    if (armed === undefined) return;
    watchers.delete(dir);
    try {
      armed.watcher.close();
    } catch {
      // Already closed by the OS.
    }
  };
  const closeAll = () => {
    for (const dir of [...watchers.keys()]) closeWatcher(dir);
  };
  const stopPolling = () => {
    if (poll === undefined) return;
    clearInterval(poll);
    poll = undefined;
    pollEvery = undefined;
  };
  const startPolling = (every: number = config.pollMs) => {
    if (closed || (poll !== undefined && pollEvery === every)) return;
    stopPolling();
    pollEvery = every;
    poll = setInterval(() => void runScan(), every);
    poll.unref();
  };
  const fallBack = (reason: string) => {
    if (closed) return;
    if (!sticky) {
      sticky = true;
      try {
        onFallback?.(reason);
      } catch {
        // Logging never changes the watch.
      }
    }
    closeAll();
    startPolling();
  };

  const schedule = () => {
    if (closed) return;
    const now = Date.now();
    firstEventAt ??= now;
    if (trailing !== undefined) clearTimeout(trailing);
    const delay = Math.max(0, Math.min(config.debounceMs, firstEventAt + config.maxWaitMs - now));
    trailing = setTimeout(() => {
      trailing = undefined;
      firstEventAt = undefined;
      void runScan();
    }, delay);
    trailing.unref();
  };

  const onRaw = (dir: string, armed: Armed, filename: string | Buffer | null) => {
    if (closed || watchers.get(dir) !== armed) return;
    if (++armed.events > config.floodLimit) {
      // A storm (Windows on a removed folder): stop listening; the scan re-arms it if the folder is still there.
      closeWatcher(dir);
    }
    if (filename !== null && filename !== undefined) hinted.add(join(dir, String(filename)));
    schedule();
  };

  const onWatcherError = (dir: string, armed: Armed, error: Error) => {
    if (closed) return;
    if (watchers.get(dir) === armed) closeWatcher(dir);
    const code = codeOf(error);
    if (FATAL_CODES.has(code)) return fallBack(code);
    countError();
  };

  /** A watcher that failed or could not be armed: rescan (re-arming what is still there), or poll for good after too many in a row. */
  const countError = () => {
    if (++watcherErrors > MAX_WATCHER_ERRORS) return fallBack('watcher_errors');
    schedule();
  };

  const scheduleConfirm = () => {
    if (confirm !== undefined || closed) return;
    confirm = setTimeout(() => {
      confirm = undefined;
      void runScan();
    }, config.confirmMs);
    confirm.unref();
  };

  /** Closes what is gone or changed and arms what is new; false when it had to fall back or a folder could not be armed. */
  const reconcile = (scanned: Map<string, string>): boolean => {
    // Recursive: the root's one watcher covers the tree (a worktree's events only cause a scan that changes nothing).
    const rootIdentity = scanned.get(root);
    const dirs = recursive && rootIdentity !== undefined ? new Map([[root, rootIdentity]]) : scanned;
    let clean = true;
    for (const [dir, armed] of [...watchers]) {
      if (dirs.get(dir) !== armed.identity || hinted.has(dir)) closeWatcher(dir);
    }
    hinted.clear();
    for (const [dir, identity] of dirs) {
      if (watchers.has(dir)) continue;
      let armed: Armed | undefined;
      try {
        const watcher = watchDir(
          dir,
          (_eventType, filename) => {
            if (armed !== undefined) onRaw(dir, armed, filename);
          },
          recursive,
        );
        armed = { identity, watcher, events: 0 };
        const self = armed;
        watcher.on('error', (error) => onWatcherError(dir, self, error));
        watchers.set(dir, armed);
        if (dir === root) rootArmed = true;
        scheduleConfirm();
      } catch (error) {
        const code = codeOf(error);
        // No room, not supported, or a UNC root (`UNKNOWN` the first time): poll for good.
        if (FATAL_CODES.has(code) || (code === 'UNKNOWN' && dir === root && !rootArmed)) {
          fallBack(code);
          return false;
        }
        // A folder removed between the scan and arming it (ENOENT, EPERM): the rescan sorts it out.
        clean = false;
        countError();
      }
    }
    return clean;
  };

  const apply = (result: ScanResult) => {
    for (const armed of watchers.values()) armed.events = 0;
    let next: string;
    if (result.missing) {
      closeAll();
      hinted.clear();
      startPolling();
      next = MISSING;
    } else {
      next = result.fingerprint;
      if (sticky) {
        closeAll();
        hinted.clear();
        startPolling();
      } else if (result.overflow || result.dirs.size > config.maxDirs) {
        // Over the caps: no watcher, and a slower poll (each one stats up to `maxScanEntries` entries).
        closeAll();
        hinted.clear();
        startPolling(config.capPollMs);
      } else if (reconcile(result.dirs)) {
        watcherErrors = 0;
        stopPolling();
      } else if (!sticky) {
        stopPolling();
      }
    }
    const changed = fingerprint !== undefined && fingerprint !== next;
    fingerprint = next;
    if (changed) {
      try {
        onSettled();
      } catch {
        // The caller's failure never stops the watch.
      }
    }
  };

  const scanOnce = async () => {
    let result: ScanResult;
    try {
      result = await scanTree(root, config.maxScanEntries);
    } catch {
      // Never crash: treat it as a change the next event or poll retries.
      return;
    }
    if (!closed) apply(result);
  };

  /** One scan at a time; a request during one runs one more after it. */
  const runScan = async (): Promise<void> => {
    if (closed) return;
    if (scanning) {
      rescan = true;
      return;
    }
    scanning = true;
    try {
      do {
        rescan = false;
        await scanOnce();
      } while (rescan && !closed);
    } finally {
      scanning = false;
    }
  };

  await runScan();

  return {
    close() {
      if (closed) return;
      closed = true;
      if (trailing !== undefined) clearTimeout(trailing);
      trailing = undefined;
      if (confirm !== undefined) clearTimeout(confirm);
      confirm = undefined;
      stopPolling();
      closeAll();
      hinted.clear();
    },
    state: () => ({
      mode: poll === undefined ? 'watch' : 'poll',
      watchers: watchers.size,
      timers: [trailing, poll, confirm].filter((timer) => timer !== undefined).length,
      pending: trailing !== undefined || confirm !== undefined || scanning,
      closed,
    }),
  };
}
