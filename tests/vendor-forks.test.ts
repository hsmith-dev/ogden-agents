/**
 * `scripts/vendor-forks.mjs` without the network: LF-normalized hashing,
 * tamper, executable-bit and lock-bump detection against a fixture folder (a
 * throwaway git repo, since only files git lists count), tag resolution with a
 * stubbed GitHub API, and the tar and zip readers it uses on GitHub tarballs
 * and the bmad-loop wheel.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkTag,
  compareVendored,
  diffEntries,
  diffExecutableBits,
  gitFiles,
  hashEntries,
  normalizeText,
  parseTar,
  readExecutableBits,
  readTree,
  readZip,
  resolveTagCommit,
} from '../scripts/vendor-forks.mjs';

const LABEL = 'vendor/bmad-method/skills';

/** The fork's files as the script derives them from the locked commit. */
function lockedEntries(): Map<string, Buffer> {
  return new Map([
    ['bmad/SKILL.md', Buffer.from('---\nname: bmad\n---\nBody\n')],
    ['bmad-brainstorming/assets/brain-methods.csv', Buffer.from('a,b\n1,2\n')],
    ['bmad/assets/logo.bin', Buffer.from([0x89, 0x00, 0x0d, 0x0a, 0x01])],
  ]);
}

let dir: string;

/** Writes the fixture as it would be committed; `crlf` simulates a Windows checkout. */
function writeFixture(crlf = false) {
  for (const [path, data] of lockedEntries()) {
    const target = join(dir, ...path.split('/'));
    mkdirSync(join(target, '..'), { recursive: true });
    const text = !data.includes(0) && crlf ? Buffer.from(data.toString('latin1').replaceAll('\n', '\r\n'), 'latin1') : data;
    writeFileSync(target, text);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vendor-forks-test-'));
  const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  expect(init.status, init.stderr).toBe(0);
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.DS_Store\n');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('hashing', () => {
  it('normalizes CRLF to LF in text but leaves binary files alone', () => {
    expect(normalizeText(Buffer.from('a\r\nb\r\n')).toString()).toBe('a\nb\n');
    const binary = Buffer.from([0x00, 0x0d, 0x0a]);
    expect(normalizeText(binary)).toEqual(binary);
  });

  it('gives a CRLF checkout the same hash as an LF one', () => {
    writeFixture(false);
    const lf = hashEntries(readTree(dir));
    writeFixture(true);
    expect(hashEntries(readTree(dir))).toBe(lf);
    expect(lf).toBe(hashEntries(lockedEntries()));
  });

  it('depends on paths and contents but not on insertion order', () => {
    const entries = lockedEntries();
    const reversed = new Map([...entries].reverse());
    expect(hashEntries(reversed)).toBe(hashEntries(entries));
    const renamed = new Map([...entries].map(([path, data]) => [path.replace('SKILL', 'skill'), data]));
    expect(hashEntries(renamed)).not.toBe(hashEntries(entries));
    expect(hashEntries(new Map([['a', Buffer.from('bc')]]))).not.toBe(hashEntries(new Map([['ab', Buffer.from('c')]])));
  });
});

describe('check', () => {
  const lockedHash = () => hashEntries(lockedEntries());

  it('passes on an untouched tree, including a CRLF checkout', () => {
    for (const crlf of [false, true]) {
      writeFixture(crlf);
      expect(
        compareVendored({ name: 'bmad-method', label: LABEL, expected: lockedEntries(), actual: readTree(dir), lockedHash: lockedHash() }),
      ).toEqual([]);
    }
  });

  it('names an edited, a missing and an added file', () => {
    writeFixture();
    writeFileSync(join(dir, 'bmad', 'SKILL.md'), '---\nname: bmad\n---\nTampered\n');
    rmSync(join(dir, 'bmad-brainstorming', 'assets', 'brain-methods.csv'));
    writeFileSync(join(dir, 'bmad', 'extra.md'), 'x\n');
    expect(
      compareVendored({ name: 'bmad-method', label: LABEL, expected: lockedEntries(), actual: readTree(dir), lockedHash: lockedHash() }),
    ).toEqual([
      `${LABEL}/bmad-brainstorming/assets/brain-methods.csv is missing`,
      `${LABEL}/bmad/SKILL.md differs from the locked fork`,
      `${LABEL}/bmad/extra.md is not in the locked fork`,
    ]);
  });

  it('fails with a hash mismatch when the lock was bumped without re-vendoring', () => {
    writeFixture();
    const bumped = new Map(lockedEntries());
    bumped.set('bmad/SKILL.md', Buffer.from('---\nname: bmad\n---\nNewer upstream\n'));
    const problems = compareVendored({ name: 'bmad-method', label: LABEL, expected: bumped, actual: readTree(dir), lockedHash: lockedHash() });
    expect(problems).toContain(`${LABEL}/bmad/SKILL.md differs from the locked fork`);
    expect(problems.at(-1)).toMatch(/^bmad-method: forks\.lock contentHash is sha256:[0-9a-f]{64}, but the locked commit gives sha256:[0-9a-f]{64}/);
  });

  it('ignores files git ignores, such as .DS_Store', () => {
    writeFixture();
    writeFileSync(join(dir, 'bmad', '.DS_Store'), 'junk');
    expect(gitFiles(dir)).toEqual([...lockedEntries().keys()].sort());
    expect(
      compareVendored({ name: 'bmad-method', label: LABEL, expected: lockedEntries(), actual: readTree(dir), lockedHash: lockedHash() }),
    ).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('names a file whose executable bit differs from the fork', () => {
    writeFixture();
    const modes = new Map([
      ['bmad/SKILL.md', 0o644],
      ['bmad/assets/logo.bin', 0o755],
      ['bmad-brainstorming/assets/brain-methods.csv', 0o644],
    ]);
    chmodSync(join(dir, 'bmad', 'assets', 'logo.bin'), 0o755);
    expect(diffExecutableBits(modes, readExecutableBits(dir, modes.keys()), LABEL)).toEqual([]);
    chmodSync(join(dir, 'bmad', 'assets', 'logo.bin'), 0o644);
    chmodSync(join(dir, 'bmad', 'SKILL.md'), 0o755);
    expect(diffExecutableBits(modes, readExecutableBits(dir, modes.keys()), LABEL)).toEqual([
      `${LABEL}/bmad/SKILL.md should not be executable, as in the locked fork`,
      `${LABEL}/bmad/assets/logo.bin should be executable, as in the locked fork`,
    ]);
  });

  it('diffEntries reports nothing for identical sets', () => {
    expect(diffEntries(lockedEntries(), lockedEntries(), LABEL)).toEqual([]);
  });
});

describe('tag check', () => {
  const COMMIT = 'a'.repeat(40);
  const fork = { repo: 'o/r', upstream: 'u/r', tag: 'v1.0.0-ogden-agents.0', commit: COMMIT, vendored: 'vendor/x', contentHash: '' };

  /** A stub GitHub API serving `routes`, 404 for anything else. */
  function api(routes: Record<string, unknown>) {
    return async (path: string) => {
      if (!(path in routes)) throw new Error(`GET ${path}: HTTP 404`);
      return routes[path];
    };
  }

  it('resolves a lightweight tag and peels an annotated one', async () => {
    const light = api({ '/repos/o/r/git/ref/tags/v1': { object: { type: 'commit', sha: COMMIT } } });
    expect(await resolveTagCommit('o/r', 'v1', light)).toBe(COMMIT);
    const annotated = api({
      '/repos/o/r/git/ref/tags/v1': { object: { type: 'tag', sha: 't1' } },
      '/repos/o/r/git/tags/t1': { object: { type: 'commit', sha: COMMIT } },
    });
    expect(await resolveTagCommit('o/r', 'v1', annotated)).toBe(COMMIT);
  });

  it('passes when the tag points at the locked commit and names a mismatch or a missing tag', async () => {
    const ref = `/repos/o/r/git/ref/tags/${fork.tag}`;
    expect(await checkTag('bmad-loop', fork, api({ [ref]: { object: { type: 'commit', sha: COMMIT } } }))).toEqual([]);
    expect(await checkTag('bmad-loop', fork, api({ [ref]: { object: { type: 'commit', sha: 'b'.repeat(40) } } }))).toEqual([
      `bmad-loop: tag ${fork.tag} in o/r points at ${'b'.repeat(40)}, but forks.lock pins ${COMMIT}`,
    ]);
    const missing = await checkTag('bmad-loop', fork, api({}));
    expect(missing).toEqual([`bmad-loop: could not resolve tag ${fork.tag} in o/r: GET ${ref}: HTTP 404`]);
  });
});

/** A ustar header block for `name`. */
function tarHeader(name: string, size: number, flag: string, prefix = ''): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write('0000644\0', 100);
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  header.write(flag, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(prefix, 345);
  return header;
}

function block(data: Buffer): Buffer {
  return Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

describe('archives', () => {
  it('reads tar entries, including pax and prefixed long paths', () => {
    const longPath = `repo-sha/${'d'.repeat(120)}/file.txt`;
    const record = (key: string, value: string) => {
      const body = ` ${key}=${value}\n`;
      let length = body.length + 2;
      if (`${length}${body}`.length !== length) length += 1;
      return `${length}${body}`;
    };
    const paxData = Buffer.from(record('path', longPath));
    const global = Buffer.from(record('comment', 'sha'));
    const tar = Buffer.concat([
      tarHeader('pax_global_header', global.length, 'g'),
      block(global),
      tarHeader('repo-sha/', 0, '5'),
      tarHeader('a.txt', 5, '0', 'repo-sha'),
      block(Buffer.from('hello')),
      tarHeader('PaxHeader', paxData.length, 'x'),
      block(paxData),
      tarHeader('ignored-short-name', 3, '0'),
      block(Buffer.from('abc')),
      tarHeader('repo-sha/link', 0, '2'),
      Buffer.alloc(1024),
    ]);
    expect(parseTar(tar).map(({ path, type, data }) => [path, type, data.toString()])).toEqual([
      ['repo-sha/', 'dir', ''],
      ['repo-sha/a.txt', 'file', 'hello'],
      [longPath, 'file', 'abc'],
      ['repo-sha/link', 'symlink', ''],
    ]);
  });

  it('reads stored and deflated zip entries, skipping directories', () => {
    const files: Array<[string, Buffer, number]> = [
      ['pkg/', Buffer.alloc(0), 0],
      ['pkg/__init__.py', Buffer.from('print("hi")\n'), 0],
      ['pkg/big.py', Buffer.from('x = 1\n'.repeat(100)), 8],
    ];
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, data, method] of files) {
      const body = method === 8 ? deflateRawSync(data) : data;
      const nameBuf = Buffer.from(name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(method, 8);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      locals.push(local, nameBuf, body);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(method, 10);
      entry.writeUInt32LE(body.length, 20);
      entry.writeUInt32LE(data.length, 24);
      entry.writeUInt16LE(nameBuf.length, 28);
      entry.writeUInt32LE(offset, 42);
      central.push(entry, nameBuf);
      offset += 30 + nameBuf.length + body.length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    const zip = Buffer.concat([...locals, cd, eocd]);
    const entries = readZip(zip);
    expect([...entries.keys()]).toEqual(['pkg/__init__.py', 'pkg/big.py']);
    expect(entries.get('pkg/big.py')?.toString()).toBe('x = 1\n'.repeat(100));
    expect(() => readZip(Buffer.from('not a zip at all, definitely not'))).toThrow(/not a zip/);
  });
});
