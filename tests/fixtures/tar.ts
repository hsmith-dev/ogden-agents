/**
 * A tiny in-memory tar.gz writer for the pinned-upstream tests (story 4.14),
 * so no test downloads a real GitHub tarball: regular files, folders, pax
 * long paths, symlinks and hardlinks, laid out the way codeload serves a
 * repo (a pax global header, then everything under one `<repo>-<commit>/`
 * folder).
 *
 * Plain Node only (no test runner import), so Vitest and Playwright specs can
 * both use it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export interface TarEntry {
  /** The path as written in the archive. */
  name: string;
  data?: string | Buffer;
  /** `file` (default), `dir`, `symlink`, `hardlink`, `fifo`. */
  type?: 'file' | 'dir' | 'symlink' | 'hardlink' | 'fifo';
  /** A link's target. */
  link?: string;
  /** The tar mode (default 0664 for files, 0775 for folders; 0755 makes an executable). */
  mode?: number;
  /** Write the path in a pax extended header (always done for paths over 100 bytes, as tar does). */
  pax?: boolean;
}

const FLAGS = { file: '0', dir: '5', symlink: '2', hardlink: '1', fifo: '6' } as const;

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function header(name: string, size: number, flag: string, link = '', mode?: number): Buffer {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, 100, 'utf8');
  block.write(octal(mode ?? (flag === '5' ? 0o775 : 0o664), 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(0, 12), 136, 'ascii');
  block.write('        ', 148, 'ascii');
  block.write(flag, 156, 'ascii');
  block.write(link, 157, 100, 'utf8');
  block.write('ustar\0', 257, 'latin1');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(sum, 7), 148, 'ascii');
  return block;
}

function pad(data: Buffer): Buffer {
  const rest = data.length % 512;
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(512 - rest)]);
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length;
  while (`${length}${body}`.length !== length) length = `${length}${body}`.length;
  return `${length}${body}`;
}

/** An uncompressed tar archive of `entries`, in order. */
export function tar(entries: readonly TarEntry[], { globalComment }: { globalComment?: string } = {}): Buffer {
  const parts: Buffer[] = [];
  if (globalComment !== undefined) {
    const data = Buffer.from(paxRecord('comment', globalComment));
    parts.push(header('pax_global_header', data.length, 'g'), pad(data));
  }
  for (const entry of entries) {
    const type = entry.type ?? 'file';
    const data = type === 'file' ? Buffer.from(entry.data ?? '') : Buffer.alloc(0);
    const pax = entry.pax === true || Buffer.byteLength(entry.name) > 100;
    if (pax) {
      const record = Buffer.from(paxRecord('path', entry.name));
      parts.push(header('PaxHeader', record.length, 'x'), pad(record));
    }
    parts.push(header(pax ? 'placeholder' : entry.name, data.length, FLAGS[type], entry.link ?? '', entry.mode), pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** {@link tar}, gzip-compressed. */
export function tarGz(entries: readonly TarEntry[], options: { globalComment?: string } = {}): Buffer {
  return gzipSync(tar(entries, options));
}

/** Every file under `dir`, as `/`-separated relative paths, sorted. */
function filesUnder(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

/**
 * A codeload-style tarball of the folder `dir` (a repo checkout): a pax
 * global header naming the commit, `<top>/`, then each folder and file under
 * it. `extra` entries are appended as given (paths already under `<top>/`).
 */
export function repoTarGz(dir: string, top: string, extra: readonly TarEntry[] = []): Buffer {
  const entries: TarEntry[] = [{ name: `${top}/`, type: 'dir' }];
  const folders = new Set<string>();
  for (const file of filesUnder(dir)) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (!folders.has(folder)) {
        folders.add(folder);
        entries.push({ name: `${top}/${folder}/`, type: 'dir' });
      }
    }
    entries.push({ name: `${top}/${file}`, data: readFileSync(join(dir, ...parts)) });
  }
  return tarGz([...entries, ...extra], { globalComment: top.split('-').pop() ?? top });
}
