/**
 * Unpacks Antigravity's pinned archive (epic 6 entry 7) one file at a time,
 * streamed from disk: the Linux server alone is about 900 MB unpacked, too
 * much to hold in memory as `toolchain-uv/archive.ts` does for uv.
 *
 * The archive has already matched its pinned SHA-256 before this runs; these
 * checks are a second line, so a wrong pin can never write outside `dir`:
 *
 * - Only regular files named exactly as in the pin are unpacked, each into
 *   `dir` under that pinned name (no path from the archive is used as a file
 *   path). An entry with an unsafe name (absolute, a drive letter, `..`, a
 *   backslash, a folder), a link or device, an encrypted or unknown
 *   compression method, an entry not in the pin, a duplicate, or a missing
 *   file refuses the whole archive before anything is written.
 * - Each file is checked as it is written: its CRC-32 and size against the
 *   archive, and its SHA-256 and size against the pin.
 * - Zip64 archives are refused (none of the pinned ones is one).
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createInflateRaw } from 'node:zlib';
/** One file an archive holds, as Ogden pinned it: its size and SHA-256. */
export interface PinnedFile {
  size: number;
  sha256: string;
}

export class UnsafeArchiveError extends Error {
  override readonly name = 'UnsafeArchiveError';
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** A central directory larger than this is not one of the pinned archives. */
const MAX_CENTRAL_DIRECTORY = 1024 * 1024;

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

interface Entry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** Whether `name` is a plain relative file path: no absolute path, drive, backslash, `.`/`..` or empty segment, NUL or folder. */
export function isSafeEntryName(name: string): boolean {
  if (name === '' || name.includes('\0') || name.includes('\\')) return false;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Reads the central directory and checks every entry before anything is written. */
async function readEntries(archive: string, files: Readonly<Record<string, PinnedFile>>): Promise<Entry[]> {
  const handle = await open(archive, 'r');
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) throw new UnsafeArchiveError('not a zip file');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new UnsafeArchiveError('zip64 archives are not supported');
    if (cdSize > MAX_CENTRAL_DIRECTORY || cdOffset + cdSize > size) throw new UnsafeArchiveError('bad zip central directory');
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);

    const entries: Entry[] = [];
    const seen = new Set<string>();
    let offset = 0;
    for (let n = 0; n < count; n++) {
      if (offset + 46 > cd.length || cd.readUInt32LE(offset) !== CENTRAL) throw new UnsafeArchiveError('bad zip central directory');
      const madeBy = cd.readUInt16LE(offset + 4) >> 8;
      const flags = cd.readUInt16LE(offset + 8);
      const method = cd.readUInt16LE(offset + 10);
      const crc = cd.readUInt32LE(offset + 16);
      const compressedSize = cd.readUInt32LE(offset + 20);
      const entrySize = cd.readUInt32LE(offset + 24);
      const nameLength = cd.readUInt16LE(offset + 28);
      const extraLength = cd.readUInt16LE(offset + 30);
      const commentLength = cd.readUInt16LE(offset + 32);
      const external = cd.readUInt32LE(offset + 38);
      const localOffset = cd.readUInt32LE(offset + 42);
      if (offset + 46 + nameLength > cd.length) throw new UnsafeArchiveError('bad zip central directory');
      const name = cd.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      offset += 46 + nameLength + extraLength + commentLength;

      if (!isSafeEntryName(name)) throw new UnsafeArchiveError('an entry has an unsafe name');
      // Unix hosts keep the file type in the high half: anything but a regular file (a link, a device) is refused.
      const mode = external >>> 16;
      // Unix (3) and OS X (19) hosts keep Unix modes.
      if ((madeBy === 3 || madeBy === 19) && mode !== 0 && (mode & S_IFMT) !== S_IFREG) throw new UnsafeArchiveError('an entry is not a regular file');
      // MS-DOS directory attribute.
      if ((external & 0x10) !== 0) throw new UnsafeArchiveError('an entry is a folder');
      const pin = Object.hasOwn(files, name) ? files[name] : undefined;
      if (pin === undefined) throw new UnsafeArchiveError('the archive holds a file that is not pinned');
      if (seen.has(name)) throw new UnsafeArchiveError('the archive holds a file twice');
      seen.add(name);
      if ((flags & 1) !== 0) throw new UnsafeArchiveError('an entry is encrypted');
      if (method !== 0 && method !== 8) throw new UnsafeArchiveError('an entry uses an unsupported compression method');
      if (compressedSize === 0xffffffff || entrySize === 0xffffffff || localOffset === 0xffffffff) throw new UnsafeArchiveError('zip64 archives are not supported');
      if (entrySize !== pin.size) throw new UnsafeArchiveError('a file is not its pinned size');
      entries.push({ name, method, crc, compressedSize, size: entrySize, localOffset });
    }
    for (const name of Object.keys(files)) if (!seen.has(name)) throw new UnsafeArchiveError('a pinned file is missing from the archive');

    // Where each entry's data starts, from its local header.
    for (const entry of entries) {
      const header = Buffer.alloc(30);
      await handle.read(header, 0, 30, entry.localOffset);
      if (header.readUInt32LE(0) !== LOCAL) throw new UnsafeArchiveError('bad zip local header');
      const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (start + entry.compressedSize > size) throw new UnsafeArchiveError('an entry runs past the end of the archive');
      entry.localOffset = start;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/**
 * Unpacks the pinned `files` of `archive` into `dir` (which must exist and
 * be empty of them). Rejects with {@link UnsafeArchiveError} for an archive
 * that isn't what the pin says; a file that fails its check is left for the
 * caller to remove with `dir`.
 */
export async function extractPinned(archive: string, dir: string, files: Readonly<Record<string, PinnedFile>>): Promise<void> {
  const entries = await readEntries(archive, files);
  for (const entry of entries) {
    const pin = files[entry.name]!;
    let crc = 0;
    let written = 0;
    const hash = createHash('sha256');
    const check = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length;
        if (written > entry.size) {
          callback(new UnsafeArchiveError('a file is larger than the archive says'));
          return;
        }
        crc = crc32(chunk, crc);
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const source = entry.compressedSize === 0 ? undefined : createReadStream(archive, { start: entry.localOffset, end: entry.localOffset + entry.compressedSize - 1 });
    // The pinned name, never the archive's path: nothing can land outside `dir`.
    const target = createWriteStream(join(dir, entry.name), { flags: 'wx', mode: 0o755 });
    const stages = entry.method === 8 ? [createInflateRaw(), check] : [check];
    try {
      if (source === undefined) {
        // An empty entry: write nothing.
        if (entry.method === 8) throw new UnsafeArchiveError('an empty entry is not deflated');
        target.end();
        await new Promise<void>((resolve, reject) => target.on('finish', resolve).on('error', reject));
      } else {
        await pipeline(source, ...(stages as [Transform]), target);
      }
    } catch (error) {
      if (error instanceof UnsafeArchiveError) throw error;
      if ((error as { code?: unknown }).code === 'Z_DATA_ERROR' || (error as { code?: unknown }).code === 'Z_BUF_ERROR') throw new UnsafeArchiveError('an entry does not inflate');
      throw error;
    }
    if (written !== entry.size || crc >>> 0 !== entry.crc >>> 0) throw new UnsafeArchiveError('an entry is corrupt');
    if (written !== pin.size || hash.digest('hex') !== pin.sha256.toLowerCase()) throw new UnsafeArchiveError('a file does not match its pin');
  }
}
