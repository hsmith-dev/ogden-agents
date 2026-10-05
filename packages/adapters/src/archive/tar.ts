/**
 * The one tar reader the adapters share (entry 4.12, moved out of
 * `bmad-source/archive.ts`): gunzip with a cap on the unpacked size, and the
 * entries of an uncompressed tar archive (ustar, with pax and GNU long
 * names). The pinned BMad Method source (`bmad-source/archive.ts`, which
 * re-exports it) and uv's archives (`toolchain-uv/archive.ts`) both read
 * through it; neither writes anything here.
 *
 * Self-contained on purpose, as `bmad-source/archive.ts`: Node builtins only
 * and erasable TypeScript syntax only, so `node` can load it without a build
 * (`scripts/bmad-lock.mjs`).
 */
import { gunzipSync } from 'node:zlib';

/** One tar entry as {@link parseTar} reads it; `path` is the raw path from the archive. */
export interface TarEntry {
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'hardlink' | 'other';
  mode: number;
  data: Buffer;
}

/** The archive was refused: unreadable, unsafe, too large once unpacked. Nothing was written. */
export class ArchiveRefusedError extends Error {
  override readonly name = 'ArchiveRefusedError';
}

/** Gunzips `archive`, refusing output past `maxBytes` (a decompression bomb) or input that isn't gzip. */
export function gunzipLimited(archive: Buffer, maxBytes: number): Buffer {
  try {
    return gunzipSync(archive, { maxOutputLength: maxBytes });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError) throw new ArchiveRefusedError(`the archive unpacks to more than ${maxBytes} bytes`);
    throw new ArchiveRefusedError(`not a gzip file: ${String(error)}`);
  }
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
  if (!/^[0-7]+$/.test(text)) throw new ArchiveRefusedError(`bad tar number "${text}"`);
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
    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq !== -1 && record.slice(0, eq) === 'path') path = record.slice(eq + 1);
    offset += length;
  }
  return path;
}

/**
 * Entries of an uncompressed tar archive (ustar, with pax and GNU long
 * names, as GitHub serves them), in archive order. Pax and GNU long-name
 * headers are applied to the next entry; global pax headers are skipped. An
 * entry running past the end refuses the archive.
 */
export function parseTar(tar: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  let offset = 0;
  let longName: string | undefined;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = tarNumber(header, 124, 12);
    const mode = tarNumber(header, 100, 8);
    const flag = header[156] === 0 ? '0' : String.fromCharCode(header[156]!);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new ArchiveRefusedError('a tar entry runs past the end of the archive');
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (flag === 'x') {
      longName = paxPath(data) ?? longName;
      continue;
    }
    if (flag === 'L') {
      longName = cString(data, 0, data.length);
      continue;
    }
    if (flag === 'g' || flag === 'K') continue;

    let name = cString(header, 0, 100);
    // POSIX ustar (`ustar\0`) has a name prefix; old GNU tar (`ustar  `) keeps other fields there.
    if (header.subarray(257, 263).toString('latin1') === 'ustar\0') {
      const prefix = cString(header, 345, 155);
      if (prefix !== '') name = `${prefix}/${name}`;
    }
    if (longName !== undefined) name = longName;
    longName = undefined;

    const type: TarEntry['type'] =
      flag === '0' || flag === '7' ? 'file' : flag === '5' ? 'dir' : flag === '2' ? 'symlink' : flag === '1' ? 'hardlink' : 'other';
    out.push({ path: name, type, mode, data });
  }
  return out;
}
