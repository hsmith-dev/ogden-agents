/**
 * Unpacks a pinned `.tar.gz` (the Linux OpenCode archives) one file at a
 * time, streamed from disk: the binary alone is about 185 MB unpacked, too
 * much to hold in memory (`toolchain-uv/archive.ts` reads uv's small
 * archives whole).
 *
 * The archive has already matched its pinned SHA-256 before this runs; these
 * checks are a second line, as `unzip.ts` for zip:
 *
 * - Only regular files named exactly as in the pin are unpacked, each under
 *   that pinned name in `dir` (no path from the archive is used as a file
 *   path). A link, device, folder, extended header, unsafe name, an entry not
 *   in the pin, a duplicate, a size that differs from the pin or a missing
 *   file refuses the whole archive.
 * - Each file's SHA-256 and size are checked against the pin as it is written.
 * - The gunzipped stream is capped at the pinned sizes plus tar's own blocks
 *   (a decompression bomb ends the unpack).
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { UnsafeArchiveError, isSafeEntryName, type PinnedFile } from './unzip.js';

const BLOCK = 512;

function cString(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function octal(buffer: Buffer, start: number, length: number): number {
  const text = cString(buffer, start, length).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new UnsafeArchiveError('a tar header is not readable');
  return parseInt(text, 8);
}

/** Unpacks the pinned `files` of `archive` into `dir` (which must exist). Rejects with {@link UnsafeArchiveError} for an archive that isn't what the pin says. */
export async function extractPinnedTarGz(archive: string, dir: string, files: Readonly<Record<string, PinnedFile>>): Promise<void> {
  const pinnedTotal = Object.values(files).reduce((sum, file) => sum + Math.ceil(file.size / BLOCK) * BLOCK, 0);
  // Pinned data, a header block and some padding per file, and the end blocks, with a little slack.
  const cap = pinnedTotal + (Object.keys(files).length + 4) * BLOCK + 64 * 1024;
  const seen = new Set<string>();
  let total = 0;
  let pending: Buffer = Buffer.alloc(0);
  let ended = false;
  /** The entry being written, if any. */
  let current: { name: string; remaining: number; padding: number; pin: PinnedFile; hash: ReturnType<typeof createHash>; out: ReturnType<typeof createWriteStream>; written: number } | undefined;
  let skipping = 0;
  /** A write that failed after the file was opened (no space, say): it ends the unpack instead of hanging it. */
  let writeError: Error | undefined;

  const finishEntry = async () => {
    const entry = current!;
    current = undefined;
    await new Promise<void>((resolve, reject) => entry.out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    if (entry.written !== entry.pin.size || entry.hash.digest('hex') !== entry.pin.sha256.toLowerCase()) throw new UnsafeArchiveError('a file does not match its pin');
  };

  const feed = async (chunk: Buffer) => {
    total += chunk.length;
    if (total > cap) throw new UnsafeArchiveError('the archive unpacks to more than the pin says');
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    for (;;) {
      if (ended) return;
      if (current !== undefined) {
        if (current.remaining > 0) {
          if (pending.length === 0) return;
          const take = Math.min(current.remaining, pending.length);
          const part = pending.subarray(0, take);
          pending = pending.subarray(take);
          current.remaining -= take;
          current.written += take;
          current.hash.update(part);
          if (writeError !== undefined) throw writeError;
          if (!current.out.write(part)) {
            const out = current.out;
            await new Promise<void>((resolve, reject) => {
              out.once('drain', resolve);
              out.once('error', reject);
            });
          }
          if (current.remaining > 0) return;
        }
        // Padding to the next block.
        skipping = current.padding;
        await finishEntry();
      }
      if (skipping > 0) {
        const take = Math.min(skipping, pending.length);
        pending = pending.subarray(take);
        skipping -= take;
        if (skipping > 0) return;
      }
      if (pending.length < BLOCK) return;
      const header = pending.subarray(0, BLOCK);
      pending = pending.subarray(BLOCK);
      if (header.every((byte) => byte === 0)) {
        ended = true;
        return;
      }
      const name = cString(header, 0, 100).replace(/^(?:\.\/)+/, '');
      const flag = header[156] === 0 ? '0' : String.fromCharCode(header[156]!);
      if (flag !== '0') throw new UnsafeArchiveError('an entry is not a regular file');
      if (header.subarray(257, 263).toString('latin1') === 'ustar\0' && cString(header, 345, 155) !== '') throw new UnsafeArchiveError('an entry has a path prefix');
      if (!isSafeEntryName(name)) throw new UnsafeArchiveError('an entry has an unsafe name');
      const pin = Object.hasOwn(files, name) ? files[name] : undefined;
      if (pin === undefined) throw new UnsafeArchiveError('the archive holds a file that is not pinned');
      if (seen.has(name)) throw new UnsafeArchiveError('the archive holds a file twice');
      const size = octal(header, 124, 12);
      if (size !== pin.size) throw new UnsafeArchiveError('a file is not its pinned size');
      seen.add(name);
      // The pinned name, never the archive's path: nothing can land outside `dir`.
      const out = createWriteStream(join(dir, name), { flags: 'wx', mode: 0o755 });
      out.on('error', (error) => {
        writeError ??= error;
      });
      await new Promise<void>((resolve, reject) => out.once('open', () => resolve()).once('error', reject));
      current = { name, remaining: size, padding: (BLOCK - (size % BLOCK)) % BLOCK, pin, hash: createHash('sha256'), out, written: 0 };
      if (size === 0) {
        skipping = 0;
        await finishEntry();
      }
    }
  };

  const gunzip = createGunzip();
  // A read failure (the file vanished, a bad disk) ends the unpack instead of crashing the server.
  const source = createReadStream(archive).on('error', (error) => gunzip.destroy(error)).pipe(gunzip);
  // A source failure ends the loop below through the iterator.
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) await feed(chunk);
  } catch (error) {
    current?.out.destroy();
    const code = (error as { code?: unknown }).code;
    if (code === 'Z_DATA_ERROR' || code === 'Z_BUF_ERROR') throw new UnsafeArchiveError('the archive does not unzip');
    throw error;
  }
  if (current !== undefined) {
    current.out.destroy();
    throw new UnsafeArchiveError('an entry runs past the end of the archive');
  }
  for (const name of Object.keys(files)) if (!seen.has(name)) throw new UnsafeArchiveError('a pinned file is missing from the archive');
}
