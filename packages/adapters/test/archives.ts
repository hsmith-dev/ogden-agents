/**
 * Builds small tar.gz and zip archives in memory for the tests, so no test
 * needs a real uv release or the network.
 */
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';

export interface Entry {
  name: string;
  data?: string | Buffer;
  /** tar type flag: '0' file (default), '5' folder, '2' symlink, 'x' pax header. */
  type?: string;
  /** Write the name through a POSIX ustar prefix (for names over 100 bytes). */
  prefix?: string;
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

function tarHeader(name: string, size: number, type: string, prefix = '', ustar = true): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(0o755, 8), 100, 'ascii');
  header.write(octal(0, 8), 108, 'ascii');
  header.write(octal(0, 8), 116, 'ascii');
  header.write(octal(size, 12), 124, 'ascii');
  header.write(octal(0, 12), 136, 'ascii');
  header.write('        ', 148, 'ascii');
  header.write(type, 156, 'ascii');
  if (ustar) {
    header.write('ustar\0', 257, 'latin1');
    header.write('00', 263, 'ascii');
    header.write(prefix, 345, 155, 'utf8');
  } else {
    header.write('ustar  \0', 257, 'latin1');
  }
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(octal(sum, 7), 148, 'ascii');
  return header;
}

function pad(data: Buffer): Buffer {
  const rest = data.length % 512;
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(512 - rest)]);
}

/** A tar archive, gzip-compressed. `gnu: true` writes old GNU headers (`ustar  `). */
export function tarGz(entries: readonly Entry[], { gnu = false } = {}): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    parts.push(tarHeader(entry.name, data.length, entry.type ?? '0', entry.prefix ?? '', !gnu), pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

/** A pax extended header entry that sets the next entry's path. */
export function paxPath(path: string): Entry {
  const body = ` path=${path}\n`;
  let length = body.length;
  while (`${length}${body}`.length !== length) length = `${length}${body}`.length;
  return { name: 'PaxHeader', type: 'x', data: `${length}${body}` };
}

/** A zip archive; entries are deflated unless `stored`. */
export function zip(entries: ReadonlyArray<{ name: string; data: string | Buffer; stored?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.data);
    const body = entry.stored ? data : deflateRawSync(data);
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.stored ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
