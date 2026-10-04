import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ArchiveError, readTarGz, readZip } from '../src/toolchain-uv/archive.js';
import { paxPath, tarGz, zip } from './archives.js';

const keep = (names: string[]) => (path: string) => (names.includes(path) ? path : undefined);

describe('readTarGz', () => {
  it('returns only the picked regular files', () => {
    const archive = tarGz([
      { name: 'uv-x/', type: '5' },
      { name: 'uv-x/uv', data: 'binary uv' },
      { name: 'uv-x/uvx', data: 'binary uvx' },
      { name: 'uv-x/README', data: 'ignored' },
      { name: 'uv-x/link', type: '2' },
    ]);
    const files = readTarGz(archive, keep(['uv-x/uv', 'uv-x/uvx', 'uv-x/link']));
    expect([...files.keys()]).toEqual(['uv-x/uv', 'uv-x/uvx']);
    expect(files.get('uv-x/uv')!.toString()).toBe('binary uv');
    expect(files.get('uv-x/uvx')!.toString()).toBe('binary uvx');
  });

  it('reads files larger than one block, ustar prefixes, pax paths, ./ names and old GNU headers', () => {
    const big = Buffer.alloc(5000, 7);
    const files = readTarGz(
      tarGz([
        { name: './a/big', data: big },
        { name: 'uv', prefix: 'deep/folder', data: 'prefixed' },
        paxPath('long/name/uv'),
        { name: 'truncated-name', data: 'from pax' },
      ]),
      (path) => path,
    );
    expect(files.get('a/big')!.equals(big)).toBe(true);
    expect(files.get('deep/folder/uv')!.toString()).toBe('prefixed');
    expect(files.get('long/name/uv')!.toString()).toBe('from pax');
    expect(files.has('truncated-name')).toBe(false);

    const gnu = readTarGz(tarGz([{ name: 'uv-x/uv', data: 'gnu' }], { gnu: true }), (path) => path);
    expect(gnu.get('uv-x/uv')!.toString()).toBe('gnu');
  });

  it('rejects a file that is not gzip, or a truncated tar', () => {
    expect(() => readTarGz(Buffer.from('not an archive'), (p) => p)).toThrow(ArchiveError);
    const whole = tarGz([{ name: 'uv', data: Buffer.alloc(2000, 1) }]);
    const cut = gzipSync(gunzipSync(whole).subarray(0, 1024));
    expect(() => readTarGz(cut, (p) => p)).toThrow(/past the end/);
  });
});

describe('readZip', () => {
  it('returns the picked files, stored or deflated', () => {
    const archive = zip([
      { name: 'uv.exe', data: 'uv binary '.repeat(100) },
      { name: 'uvx.exe', data: 'uvx', stored: true },
      { name: 'other.txt', data: 'ignored' },
    ]);
    const files = readZip(archive, keep(['uv.exe', 'uvx.exe']));
    expect(files.get('uv.exe')!.toString()).toBe('uv binary '.repeat(100));
    expect(files.get('uvx.exe')!.toString()).toBe('uvx');
    expect(files.has('other.txt')).toBe(false);
  });

  it('rejects a file that is not a zip, and a corrupt entry', () => {
    expect(() => readZip(Buffer.alloc(100), (p) => p)).toThrow(/not a zip/);
    const archive = zip([{ name: 'uv.exe', data: 'hello world', stored: true }]);
    const at = archive.indexOf('hello world');
    archive[at] = 'j'.charCodeAt(0);
    expect(() => readZip(archive, (p) => p)).toThrow(/corrupt/);
  });
});
