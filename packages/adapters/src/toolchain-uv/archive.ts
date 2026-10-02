/**
 * Minimal readers for the two archive formats uv ships: `.tar.gz` and `.zip`.
 *
 * They only ever return the regular files a caller asks for by name, as
 * buffers; nothing is written to disk here and no path from the archive is
 * ever used as a file path, so an entry like `../../x` can't escape. The
 * archive has already matched its pinned SHA-256 before either runs; the
 * bounds checks guard against a truncated file, not a hostile one.
 */
import { crc32, inflateRawSync } from 'node:zlib';
import { ArchiveRefusedError, gunzipLimited, parseTar, type TarEntry } from '../bmad-source/archive.js';

/** Picks entries by their normalized path (forward slashes, no leading `./`); returns the key to store them under. */
export type EntryPicker = (path: string) => string | undefined;

export class ArchiveError extends Error {
  override readonly name = 'ArchiveError';
}

function normalize(path: string): string {
  return path.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
}

/** The largest unpacked tar accepted (uv's archives unpack to well under this). */
const MAX_UNPACKED_TAR_BYTES = 1024 * 1024 * 1024;

/**
 * Reads a gzip-compressed tar archive and returns the picked regular files.
 * The tar itself is read by the one shared reader (`bmad-source/archive.ts`
 * `parseTar`); its refusals surface here as {@link ArchiveError}.
 */
export function readTarGz(archive: Buffer, pick: EntryPicker): Map<string, Buffer> {
  let entries: TarEntry[];
  try {
    entries = parseTar(gunzipLimited(archive, MAX_UNPACKED_TAR_BYTES));
  } catch (error) {
    if (error instanceof ArchiveRefusedError) throw new ArchiveError(error.message);
    throw error;
  }
  const found = new Map<string, Buffer>();
  for (const entry of entries) {
    // Regular files only. Links, devices and folders are skipped.
    if (entry.type !== 'file') continue;
    const key = pick(normalize(entry.path));
    if (key !== undefined) found.set(key, Buffer.from(entry.data));
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
