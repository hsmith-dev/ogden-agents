/**
 * Paths that name another computer, a device or a URL are told by their
 * spelling and never handed to the file system (Windows CI, 2026-11-01):
 * on Windows a stat of `\\host\share`, `//host/share` or
 * `https://host/x` (read as `\\host\x`) is a network lookup that took 22 s
 * while a permission rule was checked. Every file-system call here is
 * recorded, so these run on any platform.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandPathsReach, isRemotePart, pathsInsideWorkspace } from '../src/permission-matching.js';
import { isRemotePathShape, localRealpathSync, RemotePathError } from '../src/path-shape.js';

const fsCalls = vi.hoisted(() => [] as string[]);

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const recorded = <F extends (...args: never[]) => unknown>(name: string, fn: F): F =>
    ((...args: Parameters<F>) => {
      fsCalls.push(`${name} ${String(args[0])}`);
      return fn(...args);
    }) as F;
  const overrides = {
    realpathSync: Object.assign(recorded('realpathSync', actual.realpathSync), { native: recorded('realpathSync.native', actual.realpathSync.native) }),
    statSync: recorded('statSync', actual.statSync),
    lstatSync: recorded('lstatSync', actual.lstatSync),
    readlinkSync: recorded('readlinkSync', actual.readlinkSync),
    existsSync: recorded('existsSync', actual.existsSync),
    accessSync: recorded('accessSync', actual.accessSync),
    openSync: recorded('openSync', actual.openSync),
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

/** Spellings of another computer, a device or a URL. */
const REMOTE = ['//server/share', '//server/share/x', '\\\\server\\share', '\\\\?\\UNC\\server\\share', '\\\\?\\C:\\x', '\\\\.\\pipe\\x', '/\\server\\x', 'https://example.com/x', 'file:///etc/passwd', 'smb:\\\\server\\x'];

const dirs: string[] = [];
let root: string;
beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-path-shape-')));
  dirs.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'a');
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * The recorded calls that named another computer: a remote-shaped path, or
 * one naming the URL's host or the device. (`-I//server/x` also names the
 * local `/server/x`, which a stat may look at; `pattern` is narrower where no
 * such part exists.)
 */
/** Any of the names the remote spellings use. */
const NAMED = /server|example\.com|pipe|UNC/i;

const remoteCalls = (pattern = /example\.com|pipe|UNC/i) =>
  fsCalls.filter((call) => {
    const path = call.slice(call.indexOf(' ') + 1);
    return isRemotePathShape(path) || pattern.test(path);
  });

describe('remote-shaped paths are told by their spelling', () => {
  it.each(REMOTE)('%j is remote-shaped', (path) => {
    expect(isRemotePathShape(path)).toBe(true);
  });

  it.each(['C:/x', 'C://x', 'c:\\x', '/etc/passwd', 'src/a.ts', 'a//b', 'build:prod', '.', ''])('%j is not', (path) => {
    expect(isRemotePathShape(path)).toBe(false);
  });

  it('a drive is local on Windows, and any other `x:` is another computer on every platform', () => {
    expect(isRemotePart('C:/x', 'win32')).toBe(false);
    expect(isRemotePart('c:\\x', 'win32')).toBe(false);
    expect(isRemotePart('C:/x', 'darwin')).toBe(true);
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      for (const part of ['c:x', 'build:x', 'git@example.com:x/y', 'evil.example:loot', ...REMOTE]) expect(isRemotePart(part, platform), `${part} on ${platform}`).toBe(true);
    }
  });
});

describe('a permission check never hands a remote-shaped path to the file system', () => {
  const workspace = () => ({ path: root, realPath: root });

  it.each([...REMOTE.map((path) => `cat ${path}`), 'cat -I//server/x', 'cat --f=//server/x', 'cat x://server/y', 'cat git@server://x'])('%j is outside, with no file-system call naming it', (command) => {
    fsCalls.length = 0;
    expect(commandPathsReach(workspace(), command)).toBe('outside');
    expect(remoteCalls(command.startsWith('cat -') ? undefined : NAMED)).toEqual([]);
  });

  it.each(REMOTE)('a tool path %j is not inside, with no file-system call naming it', (path) => {
    fsCalls.length = 0;
    expect(pathsInsideWorkspace(workspace(), [path])).toBe(false);
    expect(remoteCalls(NAMED)).toEqual([]);
  });

  it('a link in the project to another computer, directly or through another link, is outside and never followed', () => {
    symlinkSync('//server/share', join(root, 'net'));
    symlinkSync('net', join(root, 'net2'));
    symlinkSync('\\\\server\\share', join(root, 'net3'));
    for (const command of ['cat net/x', 'cat net2/x', 'cat net', 'cat net3/x', 'cat src/../net2/x']) {
      fsCalls.length = 0;
      expect(commandPathsReach(workspace(), command), command).toBe('outside');
      expect(remoteCalls(NAMED), command).toEqual([]);
    }
    fsCalls.length = 0;
    expect(() => localRealpathSync(join(root, 'net2'))).toThrow(RemotePathError);
    expect(remoteCalls(NAMED)).toEqual([]);
  });

  it('still finds a plain path, and one through a local link, inside', () => {
    symlinkSync(join(root, 'src'), join(root, 'lib'));
    expect(commandPathsReach(workspace(), 'cat src/a.ts lib/a.ts lib/../src/a.ts new/file.ts')).toBe('inside');
    expect(pathsInsideWorkspace(workspace(), [join(root, 'lib', 'a.ts'), 'src/missing/x.ts'])).toBe(true);
    // `lib/..` is the folder holding the link's target (`root`), as the kernel reads it.
    symlinkSync(join(root, 'src'), join(root, 'deep'));
    expect(commandPathsReach(workspace(), 'cat deep/../../x')).toBe('outside');
  });
});

describe('localRealpathSync', () => {
  it('is realpathSync.native for local paths, links followed', () => {
    symlinkSync(join(root, 'src'), join(root, 'lib'));
    symlinkSync('lib/a.ts', join(root, 'file-link'));
    for (const path of [root, join(root, 'src'), join(root, 'lib'), join(root, 'lib', 'a.ts'), join(root, 'file-link'), join(root, 'lib', '..', 'src')]) {
      expect(localRealpathSync(path), path).toBe(realpathSync.native(path));
    }
  });

  it('throws ENOENT for a missing path and ELOOP for a link loop, as realpath does', () => {
    expect(() => localRealpathSync(join(root, 'missing'))).toThrow(expect.objectContaining({ code: 'ENOENT' }));
    symlinkSync('loop-b', join(root, 'loop-a'));
    symlinkSync('loop-a', join(root, 'loop-b'));
    expect(() => localRealpathSync(join(root, 'loop-a'))).toThrow(expect.objectContaining({ code: 'ELOOP' }));
  });
});
