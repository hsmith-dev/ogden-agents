/**
 * `editor-launcher-node` (AD-39; story 8.10): each editor's argv on macOS,
 * Linux and Windows (a `.cmd` shim through cmd.exe, an `.exe` started
 * directly), the colon and cmd metacharacter refusals, a relative path
 * refused, relative PATH entries ignored, a folder-confined system finding
 * nothing outside it, the environment carrying no planted key, and (POSIX)
 * a real fake `code` script recording its argv.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import type { SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditorLauncherNode, EDITORS, nodeEditorSystem, type EditorSystem } from '../src/index.js';
import { plantedProgram } from './planted-program.js';

interface Spawned {
  file: string;
  args: readonly string[];
  options: SpawnOptions;
}

/** A computer with only `files` runnable, recording each spawn; `fail` makes the child emit `error` instead of `spawn`. */
function fakeSystem(platform: NodeJS.Platform, files: readonly string[], env: Record<string, string>, fail?: string) {
  const spawned: Spawned[] = [];
  const system: EditorSystem = {
    platform,
    env,
    runnable: (path) => files.includes(path),
    start(file, args, options) {
      spawned.push({ file, args, options });
      const child = new EventEmitter() as EventEmitter & { unref(): void };
      child.unref = () => {};
      queueMicrotask(() => (fail === undefined ? child.emit('spawn') : child.emit('error', Object.assign(new Error(fail), { code: fail }))));
      return child as never;
    },
  };
  return { system, spawned };
}

const POSIX_ENV = { PATH: '/usr/bin:relative/bin:/opt/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-planted', OGDEN_AGENTS_TEST_X: '1', DISPLAY: ':0' };
const WIN_ENV = { Path: 'C:\\bin;relative\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', USERPROFILE: 'C:\\Users\\u', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe', OPENAI_API_KEY: 'sk-planted' };

describe('editor-launcher-node', () => {
  it('lists the editors found, in the fixed order, and opens VS Code with -g path:line:col', async () => {
    const { system, spawned } = fakeSystem('darwin', ['/opt/bin/code', '/Applications/Zed.app/Contents/MacOS/cli'], POSIX_ENV);
    const launcher = createEditorLauncherNode({ system });
    expect(await launcher.list()).toEqual([
      { id: 'vscode', name: 'VS Code' },
      { id: 'zed', name: 'Zed' },
    ]);
    expect(await launcher.open('vscode', '/w/src/a.ts', 12)).toBe('opened');
    expect(spawned[0]).toMatchObject({ file: '/opt/bin/code', args: ['-g', '/w/src/a.ts:12:1'] });
    expect(spawned[0]!.options).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true, cwd: '/home/u', shell: false });
    // No line: the start of the file.
    expect(await launcher.open('zed', '/w/src/a.ts')).toBe('opened');
    expect(spawned[1]).toMatchObject({ file: '/Applications/Zed.app/Contents/MacOS/cli', args: ['/w/src/a.ts:1:1'] });
  });

  it('starts a JetBrains IDE with --line and --column, the path alone without a line', async () => {
    const { system, spawned } = fakeSystem('linux', ['/usr/bin/idea.sh'], POSIX_ENV);
    const launcher = createEditorLauncherNode({ system });
    expect(await launcher.list()).toEqual([{ id: 'idea', name: 'IntelliJ IDEA' }]);
    expect(await launcher.open('idea', '/w/a.kt', 12)).toBe('opened');
    expect(await launcher.open('idea', '/w/a.kt', 3, 7)).toBe('opened');
    expect(await launcher.open('idea', '/w/a.kt')).toBe('opened');
    expect(spawned.map((one) => one.args)).toEqual([['--line', '12', '--column', '1', '/w/a.kt'], ['--line', '3', '--column', '7', '/w/a.kt'], ['/w/a.kt']]);
  });

  it('finds the known install places a desktop-started server needs (home and %VAR% expanded)', async () => {
    const mac = fakeSystem('darwin', ['/home/u/Library/Application Support/JetBrains/Toolbox/scripts/webstorm'], { PATH: '/usr/bin', HOME: '/home/u' });
    expect(await createEditorLauncherNode({ system: mac.system }).list()).toEqual([{ id: 'webstorm', name: 'WebStorm' }]);
    const win = fakeSystem('win32', ['C:\\Users\\u\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd'], WIN_ENV);
    expect(await createEditorLauncherNode({ system: win.system }).list()).toEqual([{ id: 'cursor', name: 'Cursor' }]);
    // An unset variable is no place at all, never a path at the drive root.
    const unset = fakeSystem('win32', ['\\Programs\\Zed\\bin\\zed.exe', 'C:\\Programs\\Zed\\bin\\zed.exe'], { Path: '', SystemRoot: 'C:\\Windows' });
    expect(await createEditorLauncherNode({ system: unset.system }).list()).toEqual([]);
  });

  it('on Windows starts a .cmd shim through cmd.exe with every argument quoted, verbatim, and an .exe directly', async () => {
    const { system, spawned } = fakeSystem('win32', ['C:\\bin\\code.cmd', 'C:\\bin\\idea64.exe'], WIN_ENV);
    const launcher = createEditorLauncherNode({ system });
    expect(await launcher.open('vscode', 'C:\\w\\src\\a.ts', 12)).toBe('opened');
    expect(spawned[0]).toMatchObject({ file: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/v:off', '/c', '""C:\\bin\\code.cmd" "-g" "C:\\w\\src\\a.ts:12:1""'] });
    expect(spawned[0]!.options.windowsVerbatimArguments).toBe(true);
    expect(await launcher.open('idea', 'C:\\w\\a.kt', 2)).toBe('opened');
    expect(spawned[1]).toMatchObject({ file: 'C:\\bin\\idea64.exe', args: ['--line', '2', '--column', '1', 'C:\\w\\a.kt'] });
    expect(spawned[1]!.options.windowsVerbatimArguments).toBe(false);
  });

  it('refuses, starting nothing: a cmd metacharacter in a shim path or argument, a colon in a path:line editor, a relative path, a bad line, an unknown editor', async () => {
    const { system, spawned } = fakeSystem('win32', ['C:\\bin\\code.cmd'], WIN_ENV);
    const launcher = createEditorLauncherNode({ system });
    for (const path of ['C:\\w\\100%.ts', 'C:\\w\\a&b.ts', 'C:\\w\\a!b.ts', 'C:\\w\\(a).ts', 'C:\\w\\a^b.ts', 'C:\\w\\a|b.ts', 'C:\\w\\a<b.ts']) expect(await launcher.open('vscode', path), path).toBe('unavailable');
    const shimmed = fakeSystem('win32', ['C:\\100%\\code.cmd'], { ...WIN_ENV, Path: 'C:\\100%' });
    expect(await createEditorLauncherNode({ system: shimmed.system }).open('vscode', 'C:\\w\\a.ts')).toBe('unavailable');
    expect(shimmed.spawned).toEqual([]);
    const posix = fakeSystem('linux', ['/usr/bin/code', '/usr/bin/idea'], POSIX_ENV);
    const linux = createEditorLauncherNode({ system: posix.system });
    expect(await linux.open('vscode', '/w/a:3:x.ts')).toBe('unavailable');
    // JetBrains takes the line as its own argument: a colon in the path is fine there.
    expect(await linux.open('idea', '/w/a:3:x.ts')).toBe('opened');
    expect(await linux.open('vscode', 'w/a.ts')).toBe('unavailable');
    expect(await linux.open('vscode', '/w/a.ts', 0)).toBe('unavailable');
    expect(await linux.open('vscode', '/w/a.ts', 1.5)).toBe('unavailable');
    expect(await linux.open('vscode', '/w/a.ts', 1, -1)).toBe('unavailable');
    expect(await linux.open('vscode', '/w/a\nb.ts')).toBe('unavailable');
    expect(await linux.open('sh', '/w/a.ts')).toBe('unavailable');
    expect(await linux.open('cursor', '/w/a.ts')).toBe('unavailable');
    expect(spawned).toEqual([]);
    expect(posix.spawned.map((one) => one.file)).toEqual(['/usr/bin/idea']);
  });

  it('ignores relative PATH entries, and re-resolves at each open (an editor gone since the list is unavailable)', async () => {
    const files = ['relative/bin/code', '/opt/bin/cursor'];
    const { system, spawned } = fakeSystem('linux', files, POSIX_ENV);
    const launcher = createEditorLauncherNode({ system });
    expect(await launcher.list()).toEqual([{ id: 'cursor', name: 'Cursor' }]);
    files.pop();
    expect(await launcher.open('cursor', '/w/a.ts')).toBe('unavailable');
    expect(spawned).toEqual([]);
  });

  it('gives the editor the allowlisted environment with the desktop session, never a planted key or switch', async () => {
    const { system, spawned } = fakeSystem('linux', ['/usr/bin/code'], POSIX_ENV);
    await createEditorLauncherNode({ system }).open('vscode', '/w/a.ts');
    const env = spawned[0]!.options.env!;
    // Only the absolute PATH folders: a relative one would let a launcher script's bare `dirname` run a planted program.
    expect(env).toMatchObject({ PATH: '/usr/bin:/opt/bin', HOME: '/home/u', DISPLAY: ':0' });
    expect(Object.keys(env)).not.toContain('ANTHROPIC_API_KEY');
    expect(Object.keys(env)).not.toContain('OGDEN_AGENTS_TEST_X');
  });

  it("keeps only absolute PATH folders (empty, '.' and relative dropped; Windows: drive letters), and starts in the home folder, else the filesystem's root, never the temp folder", async () => {
    const posix = fakeSystem('linux', ['/usr/bin/code'], { PATH: ':/usr/bin:.:rel', HOME: '/home/u' });
    await createEditorLauncherNode({ system: posix.system }).open('vscode', '/w/a.ts');
    expect(posix.spawned[0]!.options.env!.PATH).toBe('/usr/bin');
    expect(posix.spawned[0]!.options.cwd).toBe('/home/u');
    const homeless = fakeSystem('linux', ['/usr/bin/code'], { PATH: '/usr/bin', HOME: 'rel/home' });
    await createEditorLauncherNode({ system: homeless.system }).open('vscode', '/w/a.ts');
    expect(homeless.spawned[0]!.options.cwd).toBe('/');
    const win = fakeSystem('win32', ['C:\\bin\\code.cmd'], { ...WIN_ENV, Path: 'C:\\bin;;.;relative\\bin;\\\\host\\share;\\rooted' });
    await createEditorLauncherNode({ system: win.system }).open('vscode', 'C:\\w\\a.ts');
    expect(win.spawned[0]!.options.env!.Path).toBe('C:\\bin');
    expect(win.spawned[0]!.options.cwd).toBe('C:\\Users\\u');
    const winHomeless = fakeSystem('win32', ['C:\\bin\\code.cmd'], { Path: 'C:\\bin', PATHEXT: '.CMD', SystemRoot: 'D:\\Win' });
    await createEditorLauncherNode({ system: winHomeless.system }).open('vscode', 'C:\\w\\a.ts');
    expect(winHomeless.spawned[0]!.options.cwd).toBe('D:\\Win');
  });

  it('takes cmd.exe from ComSpec or SystemRoot only when drive-absolute, else C:\\Windows\\System32\\cmd.exe', async () => {
    for (const env of <Record<string, string>[]>[
      { ComSpec: '\\\\host\\s\\cmd.exe', SystemRoot: 'C:\\Windows' },
      { ComSpec: '\\evil\\cmd.exe', SystemRoot: 'C:\\Windows' },
      { ComSpec: '\\evil\\cmd.exe', SystemRoot: '\\\\host\\s' },
      { SystemRoot: '\\evil' },
    ]) {
      const { system, spawned } = fakeSystem('win32', ['C:\\bin\\code.cmd'], { Path: 'C:\\bin', PATHEXT: '.CMD', USERPROFILE: 'C:\\Users\\u', ...env });
      expect(await createEditorLauncherNode({ system }).open('vscode', 'C:\\w\\a.ts'), JSON.stringify(env)).toBe('opened');
      expect(spawned[0]!.file, JSON.stringify(env)).toBe('C:\\Windows\\System32\\cmd.exe');
    }
    const custom = fakeSystem('win32', ['C:\\bin\\code.cmd'], { Path: 'C:\\bin', PATHEXT: '.CMD', ComSpec: 'D:\\Win\\System32\\cmd.exe', SystemRoot: 'D:\\Win' });
    await createEditorLauncherNode({ system: custom.system }).open('vscode', 'C:\\w\\a.ts');
    expect(custom.spawned[0]!.file).toBe('D:\\Win\\System32\\cmd.exe');
  });

  it('answers unavailable when the spawn fails (ENOENT, EACCES) or throws', async () => {
    for (const code of ['ENOENT', 'EACCES']) {
      const { system } = fakeSystem('linux', ['/usr/bin/code'], POSIX_ENV, code);
      expect(await createEditorLauncherNode({ system }).open('vscode', '/w/a.ts'), code).toBe('unavailable');
    }
    const throwing: EditorSystem = { ...fakeSystem('linux', ['/usr/bin/code'], POSIX_ENV).system, start: () => { throw new Error('EINVAL'); } };
    expect(await createEditorLauncherNode({ system: throwing }).open('vscode', '/w/a.ts')).toBe('unavailable');
  });

  it('every editor of the list has a plain id and name, and is looked for on each OS', () => {
    expect(EDITORS.map((editor) => editor.id)).toEqual(['vscode', 'cursor', 'zed', 'idea', 'webstorm', 'pycharm', 'goland', 'clion', 'phpstorm', 'rubymine', 'rider', 'rustrover']);
    for (const editor of EDITORS) for (const os of ['darwin', 'linux', 'win32'] as const) expect(editor.executables[os].length, `${editor.id} ${os}`).toBeGreaterThan(0);
  });
});

describe.skipIf(process.platform === 'win32')('editor-launcher-node on this computer, confined to a folder of fakes', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  /** The server's test-run system: only the folder, as its whole PATH and home. */
  const confined = (folder: string): EditorSystem => ({
    ...nodeEditorSystem,
    runnable: (path) => {
      const from = relative(folder, path);
      return from !== '' && !from.startsWith('..') && !isAbsolute(from) && nodeEditorSystem.runnable(path);
    },
    env: { PATH: folder, HOME: folder },
  });

  for (const kind of ['empty', 'relative'] as const) {
    it(`a launcher script's bare name never reaches a program planted behind ${kind === 'empty' ? 'an empty' : 'a relative'} PATH entry in its home (8.12)`, async () => {
      const fixture = plantedProgram('code', 'opened');
      folders.push(fixture.root);
      const record = join(fixture.root, 'argv.txt');
      writeFileSync(join(fixture.bin, 'code'), `#!/bin/sh\nhelper >/dev/null 2>&1\nprintf '%s\\n' "$@" > "${record}"\n`);
      const system: EditorSystem = { ...confined(fixture.bin), env: { PATH: fixture.paths[kind], HOME: fixture.work } };
      expect(await createEditorLauncherNode({ system }).open('vscode', join(fixture.root, 'a.ts'))).toBe('opened');
      await expect.poll(() => existsSync(record)).toBe(true);
      expect(fixture.ran()).toBe(false);
    });
  }

  it('a fake code script records its argv; nothing outside the folder is found', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'ogden-editors-'));
    folders.push(folder);
    const record = join(folder, 'argv.txt');
    writeFileSync(join(folder, 'code'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${record}"\n`);
    chmodSync(join(folder, 'code'), 0o755);
    const launcher = createEditorLauncherNode({ system: confined(folder) });
    expect(await launcher.list()).toEqual([{ id: 'vscode', name: 'VS Code' }]);
    const file = join(folder, 'src', 'a.ts');
    mkdirSync(join(folder, 'src'));
    writeFileSync(file, 'x');
    expect(await launcher.open('vscode', file, 12)).toBe('opened');
    await expect.poll(() => existsSync(record) && readFileSync(record, 'utf8')).toBe(`-g\n${file}:12:1\n`);
    // An empty folder: not even a real editor installed on this computer is found.
    const empty = mkdtempSync(join(tmpdir(), 'ogden-editors-'));
    folders.push(empty);
    expect(await createEditorLauncherNode({ system: confined(empty) }).list()).toEqual([]);
  });
});
