/**
 * File-system helpers the adapters share (entry 4.12): the open flags that
 * read a file without following a link or waiting on a FIFO, a file-system
 * error's code, and (story 8.4) a read of one regular file by those flags.
 */
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

/** Never follow a link swapped in after a `realpath` or `lstat` (not on Windows, which has no such flag). */
export const NO_FOLLOW = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
/** Opening a FIFO never waits for a writer (not on Windows, which has no such flag). */
export const NON_BLOCK = (fsConstants as { O_NONBLOCK?: number }).O_NONBLOCK ?? 0;

/** A file-system error's `code` (`ENOENT`, say), or `'unknown'` when it has no string one. */
export const codeOf = (error: unknown): string => (typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : 'unknown');

/** A regular file's bytes and times, read from the one descriptor that was checked. */
export interface RegularFileRead {
  bytes: Buffer;
  atime: Date;
  mtime: Date;
}

/**
 * Reads `path` only when it is a regular file of at most `maxBytes` (story
 * 8.4): opened without following a link and without waiting on a FIFO, then
 * checked on the open descriptor, so nothing swapped in between is read.
 * `undefined` when nothing is there; a throw (`ELOOP`, `EISFIFO`-like
 * `not_regular`, `too_large`) for anything else. On Windows, which has no
 * such flags, a link is refused by `lstat` first.
 */
export function readRegularFile(path: string, maxBytes: number): RegularFileRead | undefined {
  if (NO_FOLLOW === 0) {
    try {
      if (lstatSync(path).isSymbolicLink()) throw Object.assign(new Error('a link'), { code: 'ELOOP' });
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return undefined;
      throw error;
    }
  }
  let fd: number;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'not_regular' });
    if (stat.size > maxBytes) throw Object.assign(new Error('too large'), { code: 'too_large' });
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < bytes.length) {
      const got = readSync(fd, bytes, read, bytes.length - read, read);
      if (got === 0) break;
      read += got;
    }
    return { bytes: bytes.subarray(0, read), atime: stat.atime, mtime: stat.mtime };
  } finally {
    closeSync(fd);
  }
}
