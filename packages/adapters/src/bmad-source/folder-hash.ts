/**
 * The content hash of a folder on disk (entry 4.12), by the same rule as a
 * pinned source's content hash (`archive.ts` {@link hashEntries}): regular
 * files only, keyed by their `/`-separated path below the folder, text
 * normalized CRLF to LF, in sorted path order. The label trust compares a
 * repo's skill folder with the verified pinned copy's folder this way.
 *
 * Read-only, bounded and never following a link: the folder itself must be
 * a real folder (`lstat`), every entry below it a real folder or a regular
 * file (a symlink, a FIFO or anything else answers `undefined`, as does a
 * file swapped for one between the listing and the open), at most
 * {@link FOLDER_HASH_MAX_ENTRIES} entries and {@link FOLDER_HASH_MAX_BYTES}
 * bytes in all (or the limits given). A folder is listed entry by entry
 * and the walk stops at the entry bound, so a huge folder is never listed
 * whole. Any file-system error answers `undefined`; nothing throws.
 */
import { constants as fsConstants, type Dirent } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { NON_BLOCK, NO_FOLLOW } from '../fs-safe.js';
import { hashEntries, normalizeText, type Entries } from './archive.js';

/** At most this many entries (files and folders) are read below a hashed folder. */
export const FOLDER_HASH_MAX_ENTRIES = 1000;
/** At most this many bytes of files are read below a hashed folder. */
export const FOLDER_HASH_MAX_BYTES = 8 * 1024 * 1024;

export interface FolderHashLimits {
  /** Default {@link FOLDER_HASH_MAX_ENTRIES}. */
  maxEntries?: number;
  /** Default {@link FOLDER_HASH_MAX_BYTES}. */
  maxBytes?: number;
  /** Names of real folders, at any depth, left out of the hash and not read (counted as entries all the same). */
  skipFolders?: ReadonlySet<string>;
}

/** Thrown inside the walk to stop it: the folder can't be hashed (a link, a special file, past a bound). */
class Unhashable extends Error {}

/** The contents of the regular file at `path`, opened without following a link, within `budget` bytes. */
async function readRegularFile(path: string, budget: number): Promise<Buffer> {
  const handle = await open(path, fsConstants.O_RDONLY | NON_BLOCK | NO_FOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > budget) throw new Unhashable();
    const buffer = Buffer.alloc(stat.size);
    let read = 0;
    while (read < stat.size) {
      const { bytesRead } = await handle.read(buffer, read, stat.size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return buffer.subarray(0, read);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** A folder's content hash, and how many entries and file bytes it took (the bounds for hashing another folder against it). */
export interface FolderHash {
  readonly hash: string;
  /** Files and folders below the folder. */
  readonly entries: number;
  /** Bytes of the files as read (before LF normalization). */
  readonly bytes: number;
}

/** {@link hashFolder}, with the entry and byte counts it took; `undefined` as {@link hashFolder}. */
export async function hashFolderWithCounts(dir: string, limits: FolderHashLimits = {}): Promise<FolderHash | undefined> {
  const maxEntries = limits.maxEntries ?? FOLDER_HASH_MAX_ENTRIES;
  const maxBytes = limits.maxBytes ?? FOLDER_HASH_MAX_BYTES;
  let bytes = 0;
  let count = 0;
  const entries: Entries = new Map();
  const walk = async (folder: string, prefix: string): Promise<void> => {
    // Listed one entry at a time: past the bound the listing stops (and its handle closes).
    const listed: Dirent[] = [];
    for await (const entry of await opendir(folder)) {
      if (++count > maxEntries) throw new Unhashable();
      listed.push(entry);
    }
    for (const entry of listed) {
      const path = join(folder, entry.name);
      // The entry itself (never followed): a real folder or a regular file, nothing else.
      if (entry.isDirectory()) {
        if (limits.skipFolders?.has(entry.name)) continue;
        await walk(path, `${prefix}${entry.name}/`);
      }
      else if (entry.isFile()) {
        const data = await readRegularFile(path, maxBytes - bytes);
        bytes += data.length;
        entries.set(`${prefix}${entry.name}`, normalizeText(data));
      } else throw new Unhashable();
    }
  };
  try {
    if (!(await lstat(dir)).isDirectory()) return undefined;
    await walk(dir, '');
  } catch {
    return undefined;
  }
  return { hash: hashEntries(entries), entries: count, bytes };
}

/**
 * `sha256:<hex>` over the regular files below `dir` (see the file's
 * comment), or `undefined` when `dir` isn't a real folder, holds anything
 * other than real folders and regular files, is past a bound, or can't be
 * read.
 */
export async function hashFolder(dir: string, limits: FolderHashLimits = {}): Promise<string | undefined> {
  return (await hashFolderWithCounts(dir, limits))?.hash;
}
