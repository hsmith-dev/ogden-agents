/**
 * Minimal readers for the two archive formats uv ships: `.tar.gz` and `.zip`.
 *
 * They only ever return the regular files a caller asks for by name, as
 * buffers; nothing is written to disk here and no path from the archive is
 * ever used as a file path, so an entry like `../../x` can't escape. The
 * archive has already matched its pinned SHA-256 before either runs; the
 * bounds checks guard against a truncated file, not a hostile one.
 */
import { crc32, gunzipSync, inflateRawSync } from 'node:zlib';

/** Picks entries by their normalized path (forward slashes, no leading `./`); returns the key to store them under. */
export type EntryPicker = (path: string) => string | undefined;

export class ArchiveError extends Error {
  override readonly name = 'ArchiveError';
}

function normalize(path: string): string {
  return path.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
}

const BLOCK = 512;

function cString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

/** A tar numeric field: octal text, or big-endian base-256 when the high bit is set. */
function tarNumber(buf: Buffer, start: number, length: number): number {
  const field = buf.subarray(start, start + length);
  if ((field[0]! & 0x80) !== 0) {
    let value = field[0]! & 0x7f;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i]!;
    return value;
  }
  const text = cString(buf, start, length).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError(`bad tar number "${text}"`);
  return parseInt(text, 8);
}

/** The `path` record of a pax extended header, if any. */
function paxPath(data: Buffer): string | undefined {
  let offset = 0;
  let path: string | undefined;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(data.subarray(offset, space).toString('ascii'));
    if (!Number.isInteger(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq !== -1 && record.slice(0, eq) === 'path') path = record.slice(eq + 1);
    offset += length;
  }
  return path;
}

/** Reads a gzip-compressed tar archive and returns the picked regular files. */
export function readTarGz(archive: Buffer, pick: EntryPicker): Map<string, Buffer> {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive);
  } catch (error) {
    throw new ArchiveError(`not a gzip file: ${String(error)}`);
  }
  const found = new Map<string, Buffer>();
  let offset = 0;
  let longName: string | undefined;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = tarNumber(header, 124, 12);
    const type = String.fromCharCode(header[156]!);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new ArchiveError('tar entry runs past the end of the archive');
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x') {
      longName = paxPath(data) ?? longName;
      continue;
    }
    if (type === 'L') {
      longName = cString(data, 0, data.length);
      continue;
    }
    if (type === 'g') continue;

    let name = cString(header, 0, 100);
    // POSIX ustar (`ustar\0`) has a name prefix; old GNU tar (`ustar  `) keeps other fields there.
    if (header.subarray(257, 263).toString('latin1') === 'ustar\0') {
      const prefix = cString(header, 345, 155);
      if (prefix !== '') name = `${prefix}/${name}`;
    }
    if (longName !== undefined) name = longName;
    longName = undefined;

    // Regular files only: '0' or the old-style NUL. Links, devices and folders are skipped.
    if (type !== '0' && type !== '\0') continue;
    const key = pick(normalize(name));
    if (key !== undefined) found.set(key, Buffer.from(data));
  }
  return found;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Reads a zip archive (stored or deflated entries, no zip64) and returns the picked files. */
export function readZip(archive: Buffer, pick: EntryPicker): Map<string, Buffer> {
  const minEocd = Math.max(0, archive.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = archive.length - 22; i >= minEocd; i--) {
    if (archive.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ArchiveError('not a zip file');
  const count = archive.readUInt16LE(eocd + 10);
  const cdOffset = archive.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ArchiveError('zip64 archives are not supported');

  const found = new Map<string, Buffer>();
  let offset = cdOffset;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL) {
      throw new ArchiveError('bad zip central directory');
    }
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const crc = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;

    const path = normalize(name);
    if (path.endsWith('/')) continue;
    const key = pick(path);
    if (key === undefined) continue;
    if ((flags & 1) !== 0) throw new ArchiveError(`zip entry ${path} is encrypted`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ArchiveError('zip64 archives are not supported');
    }
    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== LOCAL) {
      throw new ArchiveError(`bad zip local header for ${path}`);
    }
    const dataStart = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.length) throw new ArchiveError(`zip entry ${path} runs past the end of the archive`);
    const raw = archive.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = inflateRawSync(raw);
      } catch (error) {
        throw new ArchiveError(`zip entry ${path} does not inflate: ${String(error)}`);
      }
    } else throw new ArchiveError(`zip entry ${path} uses unsupported compression method ${method}`);
    if (data.length !== size || crc32(data) !== crc) throw new ArchiveError(`zip entry ${path} is corrupt`);
    found.set(key, data);
  }
  return found;
}
