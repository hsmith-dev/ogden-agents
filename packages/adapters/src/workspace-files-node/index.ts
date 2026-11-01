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
 */
import { constants as fsConstants, realpathSync } from 'node:fs';
import { lstat, opendir, open, readlink, realpath, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { credentialReadFences, foldSegment, isRefusedWorkspacePath, type WorkspaceFilesPort, type WorkspacePathRefusal } from '@ogden-agents/core';
import {
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_FOLDER_ENTRIES,
  REDACTED_SECRET,
  WORKSPACE_BINARY_SNIFF_BYTES,
  type WorkspaceFileEntry,
  type WorkspaceFileResponse,
  type WorkspaceFolderResponse,
} from '@ogden-agents/shared';
import { sameFile } from '../bmad-catalog/document.js';
import { realRepoRoot } from '../bmad-catalog/skills.js';
import { codeOf, NON_BLOCK, NO_FOLLOW } from '../fs-safe.js';

export interface WorkspaceFilesNodeOptions {
  /** The user's home folder: its credential folders are fenced wherever a link leads. */
  home: string;
  /** Ogden's data folder: never listed into or read, even inside a project. */
  dataDir: string;
  /** Tests only: runs after a file's path is checked and before it is opened (to swap a link in). */
  afterCheck?: (realPath: string) => Promise<void> | void;
}

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

/** Whether the file name (folded as core folds a segment) is an environment file whose values are masked. */
export function isEnvironmentFileName(name: string): boolean {
  const folded = foldSegment(name);
  return /^\.env([._-]|$)/.test(folded) || /\.env(\.|$)/.test(folded) || folded === '.envrc' || folded === '.flaskenv';
}

/** `NAME=` (optionally `export NAME=`) at a line's start: the part kept. */
const ASSIGNMENT = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=)(.*)$/;
/** A comment line: its `#` and what follows. */
const COMMENT = /^(\s*#+\s*)(.*)$/;

/** One assignment's line with its value masked (an empty value stays empty). */
const maskAssignment = (name: string, value: string): string => (value.trim() === '' ? name : `${name}${REDACTED_SECRET}`);

/** The quote a value opens and leaves open at its line's end (`KEY="line one`), if any. */
function openQuote(value: string): '"' | "'" | undefined {
  const trimmed = value.trimStart();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return undefined;
  return closes(trimmed.slice(1), quote) ? undefined : quote;
}

/** Whether `text` holds the closing `quote` (for `"`, one not escaped with `\\`). */
const closes = (text: string, quote: '"' | "'"): boolean => (quote === "'" ? text.includes("'") : /(^|[^\\])"/.test(text));

/**
 * An environment file's text with every value masked: an assignment keeps
 * `NAME=` and its value becomes {@link REDACTED_SECRET}; inside a quoted
 * value left open across lines, every line is masked whole until its
 * closing quote; a comment keeps its `#` and its text is masked whole; a
 * blank line stays; any other line is masked whole. Line endings are kept.
 */
export function maskEnvironmentText(text: string): string {
  let open: '"' | "'" | undefined;
  return text
    .split(/(\r?\n)/)
    .map((part, index) => {
      // The odd parts are the line endings.
      if (index % 2 === 1) return part;
      if (open !== undefined) {
        // A multi-line value's continuation: masked whole, whatever it looks like (a base64 line ending `==`).
        if (closes(part, open)) open = undefined;
        return part.trim() === '' ? part : REDACTED_SECRET;
      }
      if (part.trim() === '') return part;
      const comment = COMMENT.exec(part);
      if (comment !== null) return comment[2] === '' ? part : `${comment[1]!}${REDACTED_SECRET}`;
      const assignment = ASSIGNMENT.exec(part);
      if (assignment === null) return REDACTED_SECRET;
      open = openQuote(assignment[2]!);
      return maskAssignment(assignment[1]!, assignment[2]!);
    })
    .join('');
}

export function createWorkspaceFilesNode({ home, dataDir, afterCheck }: WorkspaceFilesNodeOptions): WorkspaceFilesPort {
  /** The fenced folders, worked out at each call (a credential folder may appear later). */
  const fences = (): string[] => [...credentialReadFences(home, realOrUndefined), realOrUndefined(dataDir) ?? resolve(dataDir)];

  /** Whether `real` (a real path) may be shown: inside the root, no refused segment below it, in no fence. */
  const allowed = (root: string, real: string, fenced: readonly string[]): boolean =>
    within(real, root) && !isRefusedWorkspacePath(segmentsBelow(root, real)) && !fenced.some((fence) => within(real, fence));

  /** The checked real path of `path` below the root, or why not. */
  const resolveChecked = async (rootPath: string, path: string): Promise<{ root: string; real: string; fenced: string[] } | WorkspacePathRefusal> => {
    const segments = path === '' ? [] : path.split('/');
    if (isRefusedWorkspacePath(segments)) return PROTECTED;
    const root = await realRepoRoot(rootPath);
    if (root === undefined) return NOT_FOUND;
    let real: string;
    try {
      real = await realpath(join(root, ...segments));
    } catch {
      return NOT_FOUND;
    }
    const fenced = fences();
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

  return {
    async list(rootPath, path): Promise<WorkspaceFolderResponse | WorkspacePathRefusal> {
      const checked = await resolveChecked(rootPath, path);
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
          target = await realpath(join(real, name));
        } catch {
          entries.push({ ...entry, kind: 'file', protected: false });
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

    async read(rootPath, path): Promise<WorkspaceFileResponse | WorkspacePathRefusal> {
      const checked = await resolveChecked(rootPath, path);
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
        // One byte more than the limit tells a file that grew past it since the stat.
        const buffer = Buffer.alloc(MAX_WORKSPACE_FILE_BYTES + 1);
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
  };
}
