/**
 * The Workbench's Files on the local disk (AD-36, E8-R1, E8-R2): core's
 * {@link WorkspaceFilesPort}, read-only and confined to the project.
 *
 * The project's root must be a real folder (its `realpath` is the root
 * every check uses). Every path is resolved with `realpath` (links on the
 * way followed) and refused, as `protected`, when its real path leaves the
 * root, when the real path's segments relative to the root name `.git` or a
 * credential folder but `.claude` (core's {@link isRefusedWorkspacePath},
 * folded; a name ending in `.git`, a bare repository, counts as `.git`), or
 * when it lies inside a home credential fence ({@link credentialReadFences})
 * or the data folder. A regular file with more than one link (a hard link,
 * which no path check can follow out of the project) is refused as
 * `protected` with `reason: 'hard_link'` (and listed so), unless its real
 * path is under a `node_modules` folder (pnpm hard-links its store there). A file is opened
 * `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (a link swapped in after the check
 * is refused, a FIFO never blocks) and read only when the opened file is a
 * regular file with the same device and inode as the checked path, which
 * must still resolve to itself under the same root. At most
 * {@link MAX_WORKSPACE_FILE_BYTES} are read: a longer file is `too_large`
 * with no content; a NUL in its first {@link WORKSPACE_BINARY_SNIFF_BYTES}
 * makes it `binary`. An environment file (`.env`, `.env.*`, `.envrc`,
 * `*.env`) has every value masked, its names kept. Nothing is written or
 * logged here.
 *
 * A `chat_worktree` root (epic 8 entry 2: a worktree chat's own copy, which
 * lives in the data folder) lifts the data-folder fence for that call alone;
 * every other check holds, and nothing outside that root is ever shown. Such
 * a root must lie strictly inside the chat worktrees' folder
 * (`chatWorktreesRoot`, `<data>/cw`; 27.9), else every call is `protected`.
 * `locate` checks a file exactly as `read` does and answers its real path,
 * for the editor launcher.
 *
 * `search` (8.8) walks the root breadth-first in pure Node (no git, no
 * child process), entries by name, honouring every `.gitignore` on the way
 * ({@link isIgnored}); a folder is entered only when it is not a link, not
 * refused, not ignored and allowed. Every candidate goes through this
 * port's own `read` (Text) or `locate` (File names), so a refused path, a
 * fence, a hard link, a binary or too large file never gives a result, and
 * an environment file is searched in its masked text only. A literal is
 * escaped and matched linearly; a Regex runs in a worker
 * ({@link createRegexMatcher}) terminated at the deadline or on abort. At
 * most {@link MAX_CONCURRENT_SEARCHES} run at once per port, the rest wait.
 */
import { constants as fsConstants, realpathSync } from 'node:fs';
import { lstat, opendir, open, readlink, realpath, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  credentialReadFences,
  foldSegment,
  isRefusedWorkspacePath,
  localRealpathSync,
  previewAround,
  RemotePathError,
  type WorkspaceFilesPort,
  type WorkspacePathRefusal,
  type WorkspaceRootKind,
  type WorkspaceSearchPortQuery,
  type WorkspaceSearchPortResult,
} from '@ogden-agents/core';
import {
  isEnvironmentFileName,
  maskEnvironmentText,
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_FOLDER_ENTRIES,
  WORKSPACE_BINARY_SNIFF_BYTES,
  WORKSPACE_SEARCH_MAX_FILES,
  WORKSPACE_SEARCH_MAX_MATCHES,
  WORKSPACE_SEARCH_TIMEOUT_MS,
  type WorkspaceFileEntry,
  type WorkspaceFileResponse,
  type WorkspaceFolderResponse,
  type WorkspaceSearchFile,
  type WorkspaceSearchMatch,
} from '@ogden-agents/shared';
import { sameFile } from '../bmad-catalog/document.js';
import { realRepoRoot } from '../bmad-catalog/skills.js';
import { codeOf, NON_BLOCK, NO_FOLLOW } from '../fs-safe.js';
import { isIgnored, readGitignore, type GitignoreLevel } from './gitignore.js';
import { createRegexMatcher, type RegexMatcher } from './regex-worker.js';

export interface WorkspaceFilesNodeOptions {
  /** The user's home folder: its credential folders are fenced wherever a link leads. */
  home: string;
  /** Ogden's data folder: never listed into or read, even inside a project. */
  dataDir: string;
  /**
   * The folder every chat's worktree lives in (`<data>/cw`, which the server
   * passes; 27.9): a `chat_worktree` root must lie strictly inside it, so
   * no other part of the data folder is ever shown as one. Absent: the data
   * folder itself (tests).
   */
  chatWorktreesRoot?: string;
  /** Tests only: runs after a file's path is checked and before it is opened (to swap a link in). */
  afterCheck?: (realPath: string) => Promise<void> | void;
  /** Tests only: a search's limits (time in ms, files looked at) in place of the shared caps. */
  searchLimits?: { timeoutMs?: number; maxFiles?: number };
}

/** How many searches run at once per port (per server); the rest wait their turn. */
export const MAX_CONCURRENT_SEARCHES = 2;
/** How many files one search reads (or locates) at once. */
const SEARCH_READS_AT_ONCE = 8;
/** The longest workspace-relative path a client can ask for back (`WorkspaceRelativePath`). */
const MAX_RELATIVE_PATH = 4096;

/** A file's lines, as the viewer numbers them: one last line ending ends the last line, it doesn't start another. */
const linesOf = (text: string): string[] => {
  const end = text.endsWith('\r\n') ? text.length - 2 : text.endsWith('\n') || text.endsWith('\r') ? text.length - 1 : text.length;
  return text.slice(0, end).split(/\r\n|\r|\n/);
};
/** The most entries read from one folder; past it the answer is `truncated`. */
const MAX_SEARCH_FOLDER_ENTRIES = 50_000;
/** How many entries are sorted out between turns given back to the event loop. */
const ENTRIES_PER_TURN = 256;
/** A turn of the event loop. */
const nextTurn = (): Promise<void> => new Promise((done) => setImmediate(done));

/** A literal query as a pattern of plain characters: every syntax character escaped (valid with `u`). */
const escapeLiteral = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

const PROTECTED: WorkspacePathRefusal = { refused: 'protected' };
const NOT_FOUND: WorkspacePathRefusal = { refused: 'not_found' };
const HARD_LINKED: WorkspacePathRefusal = { refused: 'protected', reason: 'hard_link' };

const realOrUndefined = (path: string): string | undefined => {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
};

/** The segments of `real` relative to `root` (`[]` for the root itself). */
const segmentsBelow = (root: string, real: string): string[] => {
  const rel = relative(root, real);
  return rel === '' ? [] : rel.split(/[\\/]/);
};

/**
 * Whether `inner` is `outer` or inside it (both real paths). Unlike a bare
 * `startsWith('..')`, a name that only begins with two dots (`..notes`) is inside.
 */
const within = (inner: string, outer: string): boolean => {
  const rel = relative(outer, inner);
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
};

/** Whether a real path below the root lies under a `node_modules` folder (folded as core folds a segment). */
const underNodeModules = (root: string, real: string): boolean => segmentsBelow(root, real).slice(0, -1).map(foldSegment).includes('node_modules');

/** Whether `info` is a regular file with more than one link whose real path is not under `node_modules`: never read. */
const refusedHardLink = (root: string, real: string, info: { isFile(): boolean; nlink: number | bigint }): boolean =>
  info.isFile() && Number(info.nlink) > 1 && !underNodeModules(root, real);

/** A name the client could never ask for back (`WorkspaceRelativePath` refuses `:`, `\` and NUL). */
const unaskable = (name: string): boolean => /[\\:\0]/.test(name);

/** A link target that names another computer or a device namespace (`\\host\share`, `\\?\`, `\\.\`, `//host`): never resolved. */
const remoteTarget = (target: string): boolean => target.startsWith('\\\\') || target.startsWith('//');

/** Moved to `@ogden-agents/shared` (8.6); kept exported here for this adapter's callers. */
export { isEnvironmentFileName, maskEnvironmentText };

export function createWorkspaceFilesNode({ home, dataDir, chatWorktreesRoot = dataDir, afterCheck, searchLimits }: WorkspaceFilesNodeOptions): WorkspaceFilesPort {
  /**
   * The fenced folders, worked out at each call (a credential folder may
   * appear later): the home credential folders, and the data folder unless
   * the root is a chat's worktree (which lives there).
   */
  const fences = (kind: WorkspaceRootKind): string[] => [...credentialReadFences(home, realOrUndefined), ...(kind === 'chat_worktree' ? [] : [realOrUndefined(dataDir) ?? resolve(dataDir)])];

  /**
   * Whether `root` (a real path) may be a `chat_worktree` root: strictly
   * inside the real data folder, and strictly inside the chat worktrees'
   * folder, which must itself be a real folder at its own place (a link
   * there could lead anywhere, an ancestor of the data folder too).
   */
  const chatRootAllowed = (root: string): boolean => {
    const data = realOrUndefined(dataDir) ?? resolve(dataDir);
    if (root === data || !within(root, data)) return false;
    const folder = realOrUndefined(chatWorktreesRoot);
    if (folder === undefined) return false;
    // Its real path is where it sits below the real data folder (`<real data>/cw`): no link on the way from the data folder to it.
    if (folder !== join(data, relative(resolve(dataDir), resolve(chatWorktreesRoot)))) return false;
    return root !== folder && within(root, folder);
  };

  /** Whether `real` (a real path) may be shown: inside the root, no refused segment below it, in no fence. */
  const allowed = (root: string, real: string, fenced: readonly string[]): boolean =>
    within(real, root) && !isRefusedWorkspacePath(segmentsBelow(root, real)) && !fenced.some((fence) => within(real, fence));

  /** The checked real path of `path` below the root, or why not. */
  const resolveChecked = async (rootPath: string, path: string, kind: WorkspaceRootKind): Promise<{ root: string; real: string; fenced: string[] } | WorkspacePathRefusal> => {
    const segments = path === '' ? [] : path.split('/');
    if (isRefusedWorkspacePath(segments)) return PROTECTED;
    const root = await realRepoRoot(rootPath);
    if (root === undefined) return NOT_FOUND;
    // A chat worktree lifts the data-folder fence only because it lives strictly inside the chat worktrees' folder: never that folder itself or above it.
    if (kind === 'chat_worktree' && !chatRootAllowed(root)) return PROTECTED;
    let real: string;
    try {
      // Never `realpath`: a link on the way to another computer is refused, not followed (on Windows that would connect to it).
      real = localRealpathSync(join(root, ...segments));
    } catch {
      return NOT_FOUND;
    }
    const fenced = fences(kind);
    return allowed(root, real, fenced) ? { root, real, fenced } : PROTECTED;
  };

  /** Whether `real` and the root still resolve to themselves (no folder on the way swapped for a link). */
  const stillThere = async (root: string, real: string): Promise<boolean> => {
    try {
      const [again, rootAgain] = await Promise.all([realpath(real), realpath(root)]);
      return again === real && rootAgain === root;
    } catch {
      return false;
    }
  };

  /**
   * The checked target's own identity, from an `lstat` of every folder from
   * the root down to it: `undefined` when any of them is a link (one swapped
   * in after the `realpath`). Rejects when one is gone.
   */
  const linkFreeIdentity = async (root: string, real: string): Promise<BigIntStats | undefined> => {
    let current = root;
    let last = await lstat(root, { bigint: true });
    if (last.isSymbolicLink()) return undefined;
    for (const segment of segmentsBelow(root, real)) {
      current = join(current, segment);
      last = await lstat(current, { bigint: true });
      if (last.isSymbolicLink()) return undefined;
    }
    return last;
  };

  /** Whether the path still has no link on the way and its target is still `identity`. */
  const stillSame = async (root: string, real: string, identity: BigIntStats): Promise<boolean> => {
    try {
      const again = await linkFreeIdentity(root, real);
      return again !== undefined && sameFile(again, identity) && (await stillThere(root, real));
    } catch {
      return false;
    }
  };

  /** Whether the entry at `real` (not a link) is a hard-linked file that is refused; false when it is gone. */
  const hardLinkedAt = async (root: string, real: string): Promise<boolean> => {
    try {
      return refusedHardLink(root, real, await lstat(real));
    } catch {
      return false;
    }
  };

  const port: WorkspaceFilesPort = {
    async list(rootPath, path, kind = 'project'): Promise<WorkspaceFolderResponse | WorkspacePathRefusal> {
      const checked = await resolveChecked(rootPath, path, kind);
      if ('refused' in checked) return checked;
      const { root, real, fenced } = checked;
      const segments = path === '' ? [] : path.split('/');
      let identity: BigIntStats | undefined;
      try {
        identity = await linkFreeIdentity(root, real);
        if (identity === undefined) return PROTECTED;
        if (!identity.isDirectory()) return NOT_FOUND;
        // What the path leads to now must still be that folder.
        if (!sameFile(identity, await stat(real, { bigint: true }))) return PROTECTED;
      } catch {
        return NOT_FOUND;
      }
      const found: Array<{ name: string; directory: boolean; link: boolean }> = [];
      let truncated = false;
      try {
        const dir = await opendir(real);
        try {
          for await (const entry of dir) {
            if (found.length >= MAX_WORKSPACE_FOLDER_ENTRIES) {
              truncated = true;
              break;
            }
            found.push({ name: entry.name, directory: entry.isDirectory(), link: entry.isSymbolicLink() });
          }
        } finally {
          await dir.close().catch(() => undefined);
        }
      } catch {
        return NOT_FOUND;
      }
      // The folder listed is still the one checked.
      if (!(await stillSame(root, real, identity))) return PROTECTED;
      const entries: WorkspaceFileEntry[] = [];
      // Each plain file's link count, looked up together (none inside a `node_modules` folder, where hard links are allowed).
      const inNodeModules = underNodeModules(root, join(real, '_'));
      const plainHardLinked = await Promise.all(found.map(({ name, directory, link }) => (!inNodeModules && !directory && !link ? hardLinkedAt(root, join(real, name)) : false)));
      for (const [index, { name, directory, link }] of found.entries()) {
        const entrySegments = [...segments, name];
        const entry = { name, path: entrySegments.join('/') };
        if (isRefusedWorkspacePath(entrySegments) || unaskable(name)) {
          entries.push({ ...entry, kind: directory ? 'folder' : 'file', protected: true });
          continue;
        }
        if (!link) {
          const shown = allowed(root, join(real, name), fenced);
          if (shown && plainHardLinked[index]) {
            entries.push({ ...entry, kind: 'file', protected: true, protectedReason: 'hard_link' });
            continue;
          }
          entries.push({ ...entry, kind: directory ? 'folder' : 'file', protected: !shown });
          continue;
        }
        // A link is shown as what it leads to, and protected when that is out of bounds; one that leads nowhere is a file.
        let target: string;
        try {
          // A link to another computer is never followed just to list it (on Windows that would connect to it).
          if (remoteTarget(await readlink(join(real, name)))) {
            entries.push({ ...entry, kind: 'file', protected: true });
            continue;
          }
          // Through a chain of links too: one leading to another computer is refused, not followed.
          target = localRealpathSync(join(real, name));
        } catch (error) {
          entries.push({ ...entry, kind: 'file', protected: error instanceof RemotePathError });
          continue;
        }
        if (!allowed(root, target, fenced)) {
          entries.push({ ...entry, kind: 'file', protected: true });
          continue;
        }
        let isFolder = false;
        let hardLinked = false;
        try {
          const info = await stat(target);
          isFolder = info.isDirectory();
          hardLinked = refusedHardLink(root, target, info);
        } catch {
          // Gone since: a file, which then reads as missing.
        }
        entries.push(hardLinked ? { ...entry, kind: 'file', protected: true, protectedReason: 'hard_link' } : { ...entry, kind: isFolder ? 'folder' : 'file', protected: false });
      }
      entries.sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.kind === 'folder' ? -1 : 1));
      return { path, entries, truncated };
    },

    async read(rootPath, path, kind = 'project'): Promise<WorkspaceFileResponse | WorkspacePathRefusal> {
      const checked = await resolveChecked(rootPath, path, kind);
      if ('refused' in checked) return checked;
      const { root, real } = checked;
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const identity = await linkFreeIdentity(root, real);
        if (identity === undefined) return PROTECTED;
        if (!identity.isFile()) return NOT_FOUND;
        if (refusedHardLink(root, real, identity)) return HARD_LINKED;
        // What the path leads to now must still be that file.
        if (!sameFile(identity, await stat(real, { bigint: true }))) return PROTECTED;
        await afterCheck?.(real);
        handle = await open(real, fsConstants.O_RDONLY | NON_BLOCK | NO_FOLLOW);
        const opened = await handle.stat({ bigint: true });
        // Only a regular file, the very one checked, still at its checked real path under the same root.
        if (!opened.isFile()) return NOT_FOUND;
        if (!sameFile(opened, identity) || !(await stillSame(root, real, identity))) return PROTECTED;
        // A hard link made after the check.
        if (refusedHardLink(root, real, opened)) return HARD_LINKED;
        const size = Number(opened.size);
        if (size > MAX_WORKSPACE_FILE_BYTES) return { kind: 'too_large', path, size, limit: MAX_WORKSPACE_FILE_BYTES };
        // One byte more than the limit tells a file that grew past it since the stat. Unzeroed: only the filled part is ever used.
        const buffer = Buffer.allocUnsafe(MAX_WORKSPACE_FILE_BYTES + 1);
        let filled = 0;
        while (filled < buffer.length) {
          const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
          if (bytesRead === 0) break;
          filled += bytesRead;
        }
        if (filled > MAX_WORKSPACE_FILE_BYTES) return { kind: 'too_large', path, size: Math.max(size, filled), limit: MAX_WORKSPACE_FILE_BYTES };
        if (buffer.subarray(0, Math.min(filled, WORKSPACE_BINARY_SNIFF_BYTES)).includes(0)) return { kind: 'binary', path, size: filled };
        const text = buffer.subarray(0, filled).toString('utf8');
        const masked = isEnvironmentFileName(path.split('/').at(-1)!) || isEnvironmentFileName(segmentsBelow(root, real).at(-1) ?? '');
        return { kind: 'text', path, content: masked ? maskEnvironmentText(text) : text, size: filled, masked };
      } catch (error) {
        // A link swapped in after the check: `O_NOFOLLOW` refuses it.
        return codeOf(error) === 'ELOOP' ? PROTECTED : NOT_FOUND;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },

    async locate(rootPath, path, kind = 'project'): Promise<{ realPath: string } | WorkspacePathRefusal> {
      const checked = await resolveChecked(rootPath, path, kind);
      if ('refused' in checked) return checked;
      const { root, real } = checked;
      try {
        const identity = await linkFreeIdentity(root, real);
        if (identity === undefined) return PROTECTED;
        if (!identity.isFile()) return NOT_FOUND;
        if (refusedHardLink(root, real, identity)) return HARD_LINKED;
        // What the path leads to now must still be that file, at its checked real path under the same root.
        if (!sameFile(identity, await stat(real, { bigint: true })) || !(await stillSame(root, real, identity))) return PROTECTED;
        return { realPath: real };
      } catch {
        return NOT_FOUND;
      }
    },
  };

  // At most MAX_CONCURRENT_SEARCHES at once: a slot, or a place in the queue.
  let running = 0;
  const waiting: Array<() => void> = [];
  const acquire = (signal: AbortSignal | undefined): Promise<boolean> => {
    if (running < MAX_CONCURRENT_SEARCHES) {
      running++;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const turn = () => {
        signal?.removeEventListener('abort', gone);
        running++;
        resolve(true);
      };
      const gone = () => {
        const at = waiting.indexOf(turn);
        if (at !== -1) waiting.splice(at, 1);
        resolve(false);
      };
      if (signal?.aborted === true) return resolve(false);
      signal?.addEventListener('abort', gone, { once: true });
      waiting.push(turn);
    });
  };
  const release = () => {
    running--;
    waiting.shift()?.();
  };

  port.search = async (rootPath: string, query: WorkspaceSearchPortQuery, kind: WorkspaceRootKind = 'project'): Promise<WorkspaceSearchPortResult> => {
    if (!(await acquire(query.signal))) return { files: [], truncated: true };
    try {
      return await runSearch(rootPath, query, kind);
    } finally {
      release();
    }
  };

  /** One search, in its slot. */
  const runSearch = async (rootPath: string, { q, mode, matchCase, regex, signal }: WorkspaceSearchPortQuery, kind: WorkspaceRootKind): Promise<WorkspaceSearchPortResult> => {
    const root = await realRepoRoot(rootPath);
    if (root === undefined) return { files: [], truncated: false };
    if (kind === 'chat_worktree' && !chatRootAllowed(root)) return { files: [], truncated: false };
    const fenced = fences(kind);
    const flags = matchCase ? 'u' : 'iu';
    // A literal never backtracks: plain characters only, matched here. A user's pattern only ever runs in the worker.
    const literal = regex ? undefined : new RegExp(escapeLiteral(q), flags);
    let worker: RegexMatcher | undefined;
    const maxFiles = searchLimits?.maxFiles ?? WORKSPACE_SEARCH_MAX_FILES;
    // One over the cap tells the use-case's clamp the answer is cut.
    const wanted = WORKSPACE_SEARCH_MAX_MATCHES + 1;
    let stopped = false;
    const stop = () => {
      stopped = true;
      worker?.terminate();
    };
    const timeoutMs = searchLimits?.timeoutMs ?? WORKSPACE_SEARCH_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(stop, timeoutMs);
    timer.unref();
    /** Whether the search must stop: the clock read too, for loops that keep the timer from firing. */
    const late = (): boolean => {
      if (!stopped && (Date.now() >= deadline || signal?.aborted === true)) stop();
      return stopped;
    };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted === true) stop();
    const found: WorkspaceSearchFile[] = [];
    let total = 0;
    let lookedAt = 0;
    let truncated = false;

    /** The first match of each of `lines`, up to `max`, as 0-based `[line, column]`; `undefined` when the search was stopped. */
    const matchLines = async (lines: readonly string[], max: number): Promise<Array<[number, number]> | undefined> => {
      if (literal !== undefined) {
        const hits: Array<[number, number]> = [];
        for (let index = 0; index < lines.length && hits.length < max; index++) {
          const at = literal.exec(lines[index]!);
          if (at !== null) hits.push([index, at.index]);
        }
        return hits;
      }
      worker ??= createRegexMatcher(q, flags);
      return stopped ? undefined : worker.match(lines, max);
    };

    try {
      const queue: Array<{ segments: string[]; levels: GitignoreLevel[] }> = [{ segments: [], levels: [] }];
      walk: while (queue.length > 0) {
        if (late()) break;
        const folder = queue.shift()!;
        const folderPath = join(root, ...folder.segments);
        // The folder is still where the walk found it: no link swapped in on the way, still allowed.
        try {
          if ((await lstat(folderPath)).isSymbolicLink() || (await realpath(folderPath)) !== folderPath || !allowed(root, folderPath, fenced)) continue;
        } catch {
          continue;
        }
        const entries: Array<{ name: string; folder: boolean; file: boolean }> = [];
        try {
          const dir = await opendir(folderPath);
          try {
            for await (const entry of dir) {
              if (stopped) break;
              if (entries.length >= MAX_SEARCH_FOLDER_ENTRIES) {
                truncated = true;
                break;
              }
              // A link is a candidate file, never a folder to enter: `read` and `locate` decide where it leads.
              entries.push({ name: entry.name, folder: entry.isDirectory(), file: entry.isFile() || entry.isSymbolicLink() });
            }
          } finally {
            await dir.close().catch(() => undefined);
          }
        } catch {
          continue;
        }
        if (stopped) break;
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const levels = entries.some((entry) => entry.name === '.gitignore' && entry.file)
          ? [...folder.levels, { base: folder.segments, rules: await readGitignore(join(folderPath, '.gitignore')) }]
          : folder.levels;
        const candidates: string[] = [];
        for (const [index, entry] of entries.entries()) {
          // Many entries against many rules: the clock is read, and the event loop given a turn, every few hundred.
          if (index % ENTRIES_PER_TURN === ENTRIES_PER_TURN - 1) {
            if (late()) break walk;
            await nextTurn();
          }
          if (unaskable(entry.name)) continue;
          const segments = [...folder.segments, entry.name];
          if (isRefusedWorkspacePath(segments)) continue;
          if (entry.folder) {
            if (!isIgnored(levels, segments, true)) queue.push({ segments, levels });
            continue;
          }
          if (!entry.file || isIgnored(levels, segments, false)) continue;
          const path = segments.join('/');
          if (path.length <= MAX_RELATIVE_PATH) candidates.push(path);
        }
        // Stepped by the batch actually taken, so a batch cut short by the files cap leaves the rest to the cap check (truncated).
        for (let start = 0; start < candidates.length; ) {
          if (late()) break walk;
          if (lookedAt >= maxFiles) {
            truncated = true;
            break walk;
          }
          const batch = candidates.slice(start, Math.min(start + SEARCH_READS_AT_ONCE, candidates.length, start + maxFiles - lookedAt));
          start += batch.length;
          lookedAt += batch.length;
          if (mode === 'names') {
            // Every path of the batch is matched (cheap), then only a match is located; the cap counts located ones only.
            const hits = await matchLines(batch, batch.length);
            if (hits === undefined) break walk;
            const matched = hits.map(([index]) => batch[index]!);
            const located = await Promise.all(matched.map((path) => port.locate!(root, path, kind).catch(() => NOT_FOUND)));
            for (const [index, path] of matched.entries()) {
              if ('refused' in located[index]!) continue;
              found.push({ path, matches: [] });
              if (++total >= wanted) {
                truncated = true;
                break walk;
              }
            }
            continue;
          }
          const read = await Promise.all(batch.map((path) => port.read(root, path, kind).catch(() => NOT_FOUND)));
          for (const [index, path] of batch.entries()) {
            if (stopped) break walk;
            const file = read[index]!;
            // Refused, gone, binary or too large: skipped.
            if ('refused' in file || file.kind !== 'text') continue;
            const lines = linesOf(file.content);
            const hits = await matchLines(lines, wanted - total);
            if (hits === undefined) break walk;
            if (hits.length === 0) continue;
            const matches: WorkspaceSearchMatch[] = hits.map(([line, column]) => ({ line: line + 1, column: column + 1, preview: previewAround(lines[line]!, column + 1) }));
            found.push({ path, matches });
            total += matches.length;
            if (total >= wanted) {
              truncated = true;
              break walk;
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      worker?.terminate();
    }
    return { files: found, truncated: truncated || stopped };
  };

  return port;
}
