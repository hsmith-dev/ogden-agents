/**
 * Terminal panes' adapter parts (epic 16, story 16.2): the pane environment
 * (AD-16, E16-R2), the user's shell by absolute path, the screen mirror and a
 * real `node-pty` running the fake shell with a viewer attaching while it
 * prints. No test runs the user's shell or a CLI.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import type { PaneProcess } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPaneMirror,
  createPtyTerminalPort,
  defaultPaneShell,
  PANE_EXTRA,
  PANE_EXTRA_WINDOWS,
  PANE_PROXIES,
  PANE_SSH_AGENT,
  paneEnvironment,
  SECRET_NAME,
  stripTerminalEscapes,
} from '../src/index.js';

const FAKE_SHELL = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-pane-shell.mjs');

const SENTINELS = {
  ANTHROPIC_API_KEY: 'sk-ant-planted',
  OPENAI_API_KEY: 'sk-planted',
  GH_TOKEN: 'ghp_planted',
  NPM_TOKEN: 'npm_planted',
  AWS_SECRET_ACCESS_KEY: 'planted',
  OGDEN_AGENTS_SECRET: 'planted',
  OGDEN_AGENTS_TEST_PANE_SHELL: '/planted.mjs',
  NODE_OPTIONS: '--require /planted.js',
  LC_API_TOKEN: 'planted-lc',
};

describe('the pane environment (E16-R2, spike 16.1 finding 10)', () => {
  const POSIX = { PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u', LANG: 'en_US.UTF-8', SHELL: '/bin/zsh', TERM: 'x', XDG_CONFIG_HOME: '/h/.config', ...SENTINELS };

  it('is the base plus COLORTERM and the XDG folders, and no planted secret', () => {
    const env = paneEnvironment({}, POSIX, 'linux');
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u', LANG: 'en_US.UTF-8', SHELL: '/bin/zsh', TERM: 'x', XDG_CONFIG_HOME: '/h/.config', COLORTERM: 'truecolor' });
    for (const name of Object.keys(SENTINELS)) expect(env, name).not.toHaveProperty(name);
    expect(Object.values(env).join('\n')).not.toContain('planted');
  });

  it('says truecolor whatever the server\'s own terminal says, since the pane is xterm.js', () => {
    expect(paneEnvironment({}, { PATH: '/bin', COLORTERM: '24bit' }, 'linux').COLORTERM).toBe('truecolor');
  });

  it('on Windows adds the folders a CLI reads (APPDATA, ProgramFiles ...), names without case, and still no secret', () => {
    const source = {
      Path: 'C:\\bin',
      SYSTEMROOT: 'C:\\Windows',
      ComSpec: 'cmd',
      PATHEXT: '.EXE',
      APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
      LocalAppData: 'C:\\Users\\u\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      ProgramData: 'C:\\ProgramData',
      windir: 'C:\\Windows',
      PSModulePath: 'C:\\m',
      COMPUTERNAME: 'PC',
      USERDOMAIN: 'PC',
      ...SENTINELS,
    };
    const env = paneEnvironment({}, source, 'win32');
    for (const name of ['Path', 'SYSTEMROOT', 'APPDATA', 'LocalAppData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'windir', 'PSModulePath', 'COMPUTERNAME', 'USERDOMAIN', 'COLORTERM']) expect(env, name).toHaveProperty(name);
    for (const name of Object.keys(SENTINELS)) expect(env, name).not.toHaveProperty(name);
    // The Windows names are not passed on another OS.
    expect(paneEnvironment({}, source, 'linux')).not.toHaveProperty('APPDATA');
  });

  it('passes proxies and the SSH agent only when the user opted in', () => {
    const source = { PATH: '/bin', HTTPS_PROXY: 'http://user:pw@proxy.invalid', http_proxy: 'http://p', NO_PROXY: 'localhost', SSH_AUTH_SOCK: '/tmp/agent.sock' };
    expect(paneEnvironment({}, source, 'linux')).toEqual({ PATH: '/bin', COLORTERM: 'truecolor' });
    expect(paneEnvironment({ proxies: true }, source, 'linux')).toMatchObject({ HTTPS_PROXY: 'http://user:pw@proxy.invalid', http_proxy: 'http://p', NO_PROXY: 'localhost' });
    expect(paneEnvironment({ proxies: true }, source, 'linux')).not.toHaveProperty('SSH_AUTH_SOCK');
    expect(paneEnvironment({ sshAgent: true }, source, 'linux')).toMatchObject({ SSH_AUTH_SOCK: '/tmp/agent.sock' });
    expect(paneEnvironment({ sshAgent: true }, source, 'linux')).not.toHaveProperty('HTTPS_PROXY');
  });

  it('no name in any allowed list looks like a credential (so no later change can add a key by name)', () => {
    for (const name of [...PANE_EXTRA, ...PANE_EXTRA_WINDOWS, ...PANE_PROXIES, ...PANE_SSH_AGENT]) expect(SECRET_NAME.test(name), name).toBe(false);
  });
});

describe("the user's own shell, by absolute path (spike 16.1 finding 9)", () => {
  const exists = (...present: string[]) => (path: string) => present.includes(path);

  it('uses SHELL when it is an absolute path that exists, as a login shell on macOS only for shells that take -l', () => {
    expect(defaultPaneShell({ platform: 'darwin', env: { SHELL: '/bin/zsh' }, exists: exists('/bin/zsh') })).toEqual({ file: '/bin/zsh', args: ['-l'] });
    expect(defaultPaneShell({ platform: 'darwin', env: { SHELL: '/opt/homebrew/bin/pwsh' }, exists: exists('/opt/homebrew/bin/pwsh') })).toEqual({ file: '/opt/homebrew/bin/pwsh', args: [] });
    expect(defaultPaneShell({ platform: 'linux', env: { SHELL: '/usr/bin/fish' }, exists: exists('/usr/bin/fish') })).toEqual({ file: '/usr/bin/fish', args: [] });
  });

  it('falls back to the system shells, and never takes a relative SHELL', () => {
    expect(defaultPaneShell({ platform: 'darwin', env: { SHELL: 'zsh' }, exists: exists('/bin/zsh') })?.file).toBe('/bin/zsh');
    expect(defaultPaneShell({ platform: 'linux', env: {}, exists: exists('/bin/sh') })?.file).toBe('/bin/sh');
    expect(defaultPaneShell({ platform: 'linux', env: {}, exists: exists() })).toBeUndefined();
  });

  it('on Windows is PowerShell by its fixed System32 path, else ComSpec', () => {
    const powershell = win32.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    expect(defaultPaneShell({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: exists(powershell) })).toEqual({ file: powershell, args: ['-NoLogo'] });
    const cmd = 'C:\\Windows\\System32\\cmd.exe';
    expect(defaultPaneShell({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', ComSpec: cmd }, exists: exists(cmd) })).toEqual({ file: cmd, args: [] });
  });
});

describe('the screen mirror', () => {
  it('serializes the screen as it is after everything written before the call, and nothing written after', async () => {
    const mirror = await createPaneMirror({ cols: 40, rows: 10, scrollback: 100 });
    mirror.write('first\r\n');
    const snapshots: string[] = [];
    mirror.snapshot((snapshot) => snapshots.push(snapshot));
    mirror.write('second\r\n');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(snapshots).toHaveLength(1);
    expect(stripTerminalEscapes(snapshots[0]!)).toContain('first');
    expect(snapshots[0]).not.toContain('second');
    mirror.dispose();
  });

  it('rebuilds a full-screen picture painted once on the alternate screen, scrollback and all', async () => {
    const mirror = await createPaneMirror({ cols: 40, rows: 10, scrollback: 100 });
    for (let i = 0; i < 30; i += 1) mirror.write(`history-${i}\r\n`);
    mirror.write('\x1b[?1049h\x1b[2J\x1b[H');
    for (let row = 1; row <= 4; row += 1) mirror.write(`\x1b[${row};1Hpicture-${row}`);
    const snapshot = await new Promise<string>((resolve) => mirror.snapshot(resolve));
    expect(snapshot).toContain('?1049h');
    for (let row = 1; row <= 4; row += 1) expect(snapshot).toContain(`picture-${row}`);
    expect(snapshot).toContain('history-29');
    mirror.dispose();
  });

  it('never calls back after it is disposed', async () => {
    const mirror = await createPaneMirror({ cols: 40, rows: 10, scrollback: 10 });
    let called = false;
    mirror.snapshot(() => (called = true));
    mirror.dispose();
    mirror.write('x');
    mirror.snapshot(() => (called = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(called).toBe(false);
  });
});

describe('the screen\'s last lines (story 16.6)', () => {
  it('reads the last non empty lines of the visible screen, after everything written before, oldest first', async () => {
    const mirror = await createPaneMirror({ cols: 40, rows: 6, scrollback: 100 });
    mirror.write('one\r\n\r\ntwo\r\nDo you want to proceed? (y/n)');
    const lines = await new Promise<string[]>((resolve) => mirror.lastLines(2, resolve));
    expect(lines).toEqual(['two', 'Do you want to proceed? (y/n)']);
    const all = await new Promise<string[]>((resolve) => mirror.lastLines(10, resolve));
    expect(all).toEqual(['one', 'two', 'Do you want to proceed? (y/n)']);
    mirror.dispose();
  });

  it('follows a redrawing screen: only what is on it now', async () => {
    const mirror = await createPaneMirror({ cols: 40, rows: 4, scrollback: 10 });
    mirror.write('first screen\r\nold line');
    mirror.write('\x1b[2J\x1b[Hnew screen\r\nProceed? (y/n)');
    expect(await new Promise<string[]>((resolve) => mirror.lastLines(5, resolve))).toEqual(['new screen', 'Proceed? (y/n)']);
    mirror.dispose();
  });
});

describe('a real pane (node-pty and the fake shell)', { timeout: 30_000 }, () => {
  const dirs: string[] = [];
  const panes: PaneProcess[] = [];
  afterEach(async () => {
    for (const pane of panes.splice(0)) pane.kill();
    // Windows keeps a folder a process still uses: give the programs a moment to be gone.
    await new Promise((resolve) => setTimeout(resolve, process.platform === 'win32' ? 500 : 0));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function open(cols = 100, rows = 30) {
    const cwd = mkdtempSync(join(tmpdir(), 'ogden-agents-pane-'));
    dirs.push(cwd);
    const port = createPtyTerminalPort();
    const available = await port.available();
    if (!available.ok) throw new Error(`node-pty did not load: ${available.reason}`);
    const pane = await port.openPane!({ file: process.execPath, args: [FAKE_SHELL], cwd, env: { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }) }, cols, rows, scrollback: 500 });
    panes.push(pane);
    return pane;
  }

  const until = async (predicate: () => boolean, what: string, ms = 15_000) => {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('gives a late viewer the screen so far and then the live output, with none missed or repeated', async () => {
    const pane = await open();
    expect(typeof pane.pid).toBe('number');
    let seen = '';
    pane.onData((data) => (seen += data));
    await until(() => stripTerminalEscapes(seen).includes('fake-shell-ready'), 'the first prompt');
    pane.write('echo before\r');
    await until(() => stripTerminalEscapes(seen).includes('echo:echo'), 'the first answer');
    let snapshot: string | undefined;
    let live = '';
    pane.attach(
      (shown) => {
        snapshot = shown;
      },
      (data) => (live += data),
    );
    pane.write('echo after\r');
    await until(() => stripTerminalEscapes(live).includes('after'), 'the live output');
    await until(() => snapshot !== undefined, 'the snapshot');
    expect(stripTerminalEscapes(snapshot!)).toContain('fake-shell-ready');
    expect(stripTerminalEscapes(snapshot!)).toContain('echo:echo');
    // What the snapshot held is not repeated in the live output.
    expect(stripTerminalEscapes(live)).not.toContain('fake-shell-ready');
  });

  it('reports its exit and still gives its last screen to a viewer that comes after', async () => {
    const pane = await open();
    let exited: { exitCode: number | null } | undefined;
    pane.onExit((exit) => (exited = exit));
    let seen = '';
    pane.onData((data) => (seen += data));
    await until(() => stripTerminalEscapes(seen).includes('fake-shell-ready'), 'the prompt');
    pane.write('exit 4\r');
    await until(() => exited !== undefined, 'the exit');
    expect(exited).toEqual({ exitCode: 4 });
    let snapshot = '';
    pane.attach((shown) => (snapshot = shown), () => {});
    await until(() => snapshot !== '', 'the last screen');
    expect(stripTerminalEscapes(snapshot)).toContain('bye');
  });

  it('reads its own screen for the status guess', async () => {
    const pane = await open();
    let seen = '';
    pane.onData((data) => (seen += data));
    await until(() => stripTerminalEscapes(seen).includes('fake-shell-ready'), 'the prompt');
    pane.write('perm\r');
    await until(() => stripTerminalEscapes(seen).includes('(y/n)'), 'the question');
    const lines = await pane.screenLines(1);
    expect(lines.join('\n')).toContain('Do you want to proceed? (y/n)');
  });

  it('follows a resize with its mirror too', async () => {
    const pane = await open(100, 30);
    let seen = '';
    pane.onData((data) => (seen += data));
    await until(() => stripTerminalEscapes(seen).includes('fake-shell-ready'), 'the prompt');
    pane.resize(60, 20);
    // The program learns of the new size by a signal that may land after the next line: ask until it has.
    await until(() => {
      pane.write('size\r');
      return stripTerminalEscapes(seen).includes('size=60x20');
    }, 'the new size');
    let snapshot = '';
    pane.attach((shown) => (snapshot = shown), () => {});
    await until(() => snapshot !== '', 'a snapshot at the new size');
  });
});
