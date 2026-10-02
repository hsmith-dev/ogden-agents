/**
 * A document a planning session wrote (story 4.7): the `bmad-catalog`
 * adapter's `readDocument`, read-only and confined.
 *
 * The repo root must be a real folder (as `detect`). The output folder and
 * the file are each resolved with `realpath`: the folder's real path must lie
 * inside the repo's, and the file's inside the folder's, so a link anywhere
 * on the way that leads out (the file, the folder, or a folder between) is
 * never read. The file must end in `.md`, is opened `O_NOFOLLOW |
 * O_NONBLOCK` (a link swapped in after the `realpath` is refused, a FIFO
 * never blocks the open) and is read only when the opened file is a regular
 * file, at most `MAX_DOCUMENT_BYTES` (a longer one is cut there, and a
 * multi-byte character split at the cut is dropped). After the open, the
 * opened file must still be the one at the checked real path (same device
 * and inode as a fresh `stat`), and that path must still resolve to itself
 * inside both folders: a folder on the way swapped for a link between the
 * check and the open (which `O_NOFOLLOW` can't see, and Windows has no such
 * flag) answers `null`. Anything else, or any file-system error, answers
 * `null`. Nothing is written.
 */
import { constants as fsConstants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_DOCUMENT_BYTES, RepoRelativePath } from '@ogden-agents/shared';
import { inside, realRepoRoot } from './skills.js';

/** Never follow a link swapped in after the `realpath` (not on Windows, which has no such flag). */
const NO_FOLLOW = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
/** Opening a FIFO never waits for a writer (not on Windows, which has no such flag). */
const NON_BLOCK = (fsConstants as { O_NONBLOCK?: number }).O_NONBLOCK ?? 0;

/** A repo-relative path's segments, or `undefined` when it isn't one (or has an empty or `.` segment). */
function segmentsOf(path: string): string[] | undefined {
  if (typeof path !== 'string' || !RepoRelativePath.safeParse(path).success) return undefined;
  const segments = path.split('/');
  return segments.some((segment) => segment === '' || segment === '.') ? undefined : segments;
}

/** A file's identity as `stat` gives it. */
export interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

/** Whether two stats name the same file (device and inode). */
export function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * The first `limit` bytes of the regular file at `file` as UTF-8 text, and
 * whether there was more; `null` otherwise, or when `stillThere` says the
 * opened file is no longer the one checked.
 */
async function readCapped(
  file: string,
  limit: number,
  stillThere: (opened: FileIdentity) => Promise<boolean>,
): Promise<{ content: string; truncated: boolean } | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, fsConstants.O_RDONLY | NON_BLOCK | NO_FOLLOW);
    const opened = await handle.stat({ bigint: true });
    // Only a regular file is read: checked on the opened file itself, not the path.
    if (!opened.isFile()) return null;
    if (!(await stillThere(opened))) return null;
    // One byte more than the limit tells a cut file from one exactly at it.
    const buffer = Buffer.alloc(limit + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    const truncated = filled > limit;
    let end = Math.min(filled, limit);
    // A cut inside a multi-byte character drops that character's leading bytes.
    if (truncated) {
      let start = end;
      while (start > 0 && (buffer[start - 1]! & 0xc0) === 0x80) start--;
      if (start > 0) {
        const lead = buffer[start - 1]!;
        const length = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
        if (length > end - (start - 1)) end = start - 1;
      }
    }
    return { content: buffer.subarray(0, end).toString('utf8'), truncated };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * The document at `path` (repo-relative) inside `outputFolder`
 * (repo-relative) of the repo at `repoPath`, confined as the file's comment
 * says; `null` when it can't or mustn't be read.
 */
export async function readDocument(
  repoPath: string,
  outputFolder: string,
  path: string,
  limit: number = MAX_DOCUMENT_BYTES,
): Promise<{ content: string; truncated: boolean } | null> {
  const fileParts = segmentsOf(path);
  const folderParts = segmentsOf(outputFolder);
  if (fileParts === undefined || folderParts === undefined || !fileParts.at(-1)!.endsWith('.md')) return null;
  const repoReal = await realRepoRoot(repoPath);
  if (repoReal === undefined) return null;
  let folderReal: string;
  let fileReal: string;
  try {
    folderReal = await realpath(join(repoReal, ...folderParts));
    fileReal = await realpath(join(repoReal, ...fileParts));
  } catch {
    return null;
  }
  if (!inside(folderReal, repoReal) || folderReal === repoReal) return null;
  if (!inside(fileReal, folderReal) || fileReal === folderReal) return null;
  // The real file must still be Markdown: a `.md` link to another file is not read.
  if (!fileReal.endsWith('.md')) return null;
  // After the open: the opened file is the one at the checked path, which still resolves to itself inside both folders.
  const stillThere = async (opened: FileIdentity): Promise<boolean> => {
    try {
      if (!sameFile(opened, await stat(fileReal, { bigint: true }))) return false;
      const [again, folderAgain, repoAgain] = await Promise.all([realpath(fileReal), realpath(folderReal), realpath(repoReal)]);
      return again === fileReal && folderAgain === folderReal && repoAgain === repoReal && inside(again, folderReal) && inside(folderReal, repoReal);
    } catch {
      return false;
    }
  };
  return readCapped(fileReal, limit, stillThere);
}
