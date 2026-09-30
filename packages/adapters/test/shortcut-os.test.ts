/**
 * The `shortcut-os` adapter (story 2.4). Every writer runs on every OS but
 * writes only into temp folders passed in as the home, Start Menu and XDG
 * folders: no test creates a shortcut on the real computer. The OS's own
 * checkers run where they exist: `plutil -lint` (macOS), a real `.lnk` read
 * back through PowerShell (Windows, in a temp folder), `desktop-file-validate`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_SHORTCUT_STATE_FILE,
  CREATE_LINK_SCRIPT,
  createOsAppShortcut,
  createMacosWriter,
  DESKTOP_FILE_NAME,
  desktopEntry,
  desktopExecArg,
  LINK_DESCRIPTION,
  LINK_ENV,
  MACOS_APP_NAME,
  MACOS_BUNDLE_ID,
  MACOS_EXECUTABLE,
  powerShellInvocation,
  READ_LINK_SCRIPT,
  shQuote,
  ShortcutRefusal,
  WINDOWS_LINK_NAME,
  xmlEscape,
  type LinkFields,
  type OsAppShortcutOptions,
  type PowerShellRunner,
} from '../src/index.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A temp folder whose name has every character the formats must escape. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ogden agents 'q' $HOME 100% -"));
  dirs.push(dir);
  return dir;
}

/** Windows file names can't have `"`; elsewhere a path can. */
const QUOTE = process.platform === 'win32' ? '' : '"';

/** A launcher and Node under a folder with spaces, quotes, `$` and `%`. */
function paths(root: string, version = 'v1') {
  const install = join(root, `pkg ${QUOTE}x${QUOTE} $PATH 50% it's`, version);
  return { launcherEntry: join(install, 'bin', 'ogden.js'), nodePath: join(install, 'node', 'bin', 'node') };
}

function shortcutFor(platform: string, root: string, extra: Partial<OsAppShortcutOptions> = {}) {
  const home = join(root, 'home');
  const stateDir = join(root, 'data');
  return createOsAppShortcut({
    platform,
    ...paths(root),
    stateDir,
    homeDir: home,
    xdgDataHome: join(home, 'xdg data'),
    programsDir: join(home, 'Start Menu', 'Programs'),
    runPowerShell: async () => {
      throw new Error('PowerShell must not run in this test');
    },
    ...extra,
  });
}

/** Undoes `shQuote` for the words of one sh line (enough for the lines these tests write). */
function shWords(line: string): string[] {
  const words: string[] = [];
  let current = '';
  let quoted = false;
  let inWord = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === "'") quoted = false;
      else current += char;
    } else if (char === "'") {
      quoted = true;
      inWord = true;
    } else if (char === '\\') {
      current += line[++i]!;
      inWord = true;
    } else if (char === ' ') {
      if (inWord) words.push(current);
      current = '';
      inWord = false;
    } else {
      current += char;
      inWord = true;
    }
  }
  if (inWord) words.push(current);
  return words;
}

/** Undoes `desktopExecArg` for an `Exec` value (the spec's unescaping, in order). */
function execArgs(value: string): string[] {
  const unescaped = value.replaceAll('%%', '\u0000').replace(/\\(.)/g, (_, char: string) => (char === 't' ? '\t' : char)).replaceAll('\u0000', '%');
  const args: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"/g;
  for (const match of unescaped.matchAll(pattern)) args.push(match[1]!.replace(/\\(.)/g, '$1'));
  return args;
}

describe('escaping', () => {
  const nasty = `/a b/it's "q" $HOME \`x\` 100% back\\slash\ttab`;

  it('sh quotes any path as one word', () => {
    expect(shWords(`exec ${shQuote(nasty)}`)).toEqual(['exec', nasty]);
    const run = spawnSync('sh', ['-c', `printf %s ${shQuote(nasty)}`], { encoding: 'utf8' });
    if (run.error === undefined) expect(run.stdout).toBe(nasty);
  });

  it('escapes XML text', () => {
    expect(xmlEscape(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  });

  it('quotes a .desktop Exec argument, doubling backslashes and percent signs', () => {
    expect(desktopExecArg('/a b/100%')).toBe('"/a b/100%%"');
    expect(desktopExecArg('/x$y')).toBe('"/x\\\\$y"');
    expect(execArgs(`${desktopExecArg(nasty)} ${desktopExecArg('/plain')}`)).toEqual([nasty, '/plain']);
    expect(() => desktopExecArg('/a\nb')).toThrow();
  });
});

describe('macOS: ~/Applications/Ogden Agents.app', () => {
  it('writes a bundle whose script runs the pinned Node and launcher, logging to the data folder', async () => {
    const root = tempDir();
    const shortcut = shortcutFor('darwin', root);
    expect(await shortcut.status()).toEqual({ platform: 'darwin', supported: true, installed: false, offerDismissed: false });
    await shortcut.add();
    expect((await shortcut.status()).installed).toBe(true);

    const app = join(root, 'home', 'Applications', MACOS_APP_NAME);
    const plist = readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8');
    expect(plist).toContain(`<key>CFBundleIdentifier</key>\n\t<string>${MACOS_BUNDLE_ID}</string>`);
    expect(plist).toContain('<key>LSUIElement</key>\n\t<true/>');
    const executable = join(app, 'Contents', 'MacOS', MACOS_EXECUTABLE);
    const script = readFileSync(executable, 'utf8');
    if (process.platform !== 'win32') expect(statSync(executable).mode & 0o777).toBe(0o755);
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    const execLine = script.split('\n').find((line) => line.startsWith('exec '))!;
    const { launcherEntry, nodePath } = paths(root);
    const words = shWords(execLine);
    expect(words.slice(0, 3)).toEqual(['exec', nodePath, launcherEntry]);
    expect(words[3]!.startsWith('>>')).toBe(true);
    expect(words[3]!.slice(2).split(/[\\/]/).slice(-2)).toEqual(['logs', 'launcher.log']);
    // No URL, code or token: only the launcher.
    expect(script).not.toMatch(/https?:|#c=|token/i);
  });

  it.runIf(process.platform === 'darwin')('writes an Info.plist that plutil accepts, and a script sh can parse', async () => {
    const root = tempDir();
    await shortcutFor('darwin', root).add();
    const app = join(root, 'home', 'Applications', MACOS_APP_NAME);
    execFileSync('plutil', ['-lint', join(app, 'Contents', 'Info.plist')]);
    execFileSync('sh', ['-n', join(app, 'Contents', 'MacOS', MACOS_EXECUTABLE)]);
  });

  it('adding again is idempotent, and a new launcher path re-points it in place', async () => {
    const root = tempDir();
    await shortcutFor('darwin', root).add();
    await shortcutFor('darwin', root).add();
    const moved = paths(root, 'v2');
    await shortcutFor('darwin', root, moved).add();
    const app = join(root, 'home', 'Applications', MACOS_APP_NAME);
    const words = shWords(readFileSync(join(app, 'Contents', 'MacOS', MACOS_EXECUTABLE), 'utf8').split('\n').find((line) => line.startsWith('exec '))!);
    expect(words.slice(1, 3)).toEqual([moved.nodePath, moved.launcherEntry]);
  });

  it("never replaces or removes an Ogden Agents.app that isn't ours", async () => {
    const root = tempDir();
    const app = join(root, 'home', 'Applications', MACOS_APP_NAME);
    mkdirSync(join(app, 'Contents'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>com.example.other</string></dict></plist>');
    const shortcut = shortcutFor('darwin', root);
    expect((await shortcut.status()).installed).toBe(false);
    await expect(shortcut.add()).rejects.toBeInstanceOf(ShortcutRefusal);
    await expect(shortcut.remove()).rejects.toThrow(/left alone/);
    expect(existsSync(join(app, 'Contents', 'Info.plist'))).toBe(true);
    // A folder with no Info.plist at all is not ours either.
    rmSync(join(app, 'Contents', 'Info.plist'));
    await expect(shortcut.remove()).rejects.toBeInstanceOf(ShortcutRefusal);
    expect(existsSync(app)).toBe(true);
  });

  it('swaps the bundle by renames, and puts the old one back if the new one cannot be moved in', async () => {
    const root = tempDir();
    const applications = join(root, 'Applications');
    const target = { ...paths(root), logDir: join(root, 'logs') };
    await createMacosWriter(applications).install(target);
    const executable = join(applications, MACOS_APP_NAME, 'Contents', 'MacOS', MACOS_EXECUTABLE);
    const before = readFileSync(executable, 'utf8');

    const failing = createMacosWriter(applications, {
      rename: (from, to) => {
        if (to.endsWith(MACOS_APP_NAME) && from.endsWith('.tmp')) throw Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' });
        renameSync(from, to);
      },
    });
    await expect(failing.install({ ...paths(root, 'v2'), logDir: target.logDir })).rejects.toThrow(/EXDEV/);
    expect(readFileSync(executable, 'utf8')).toBe(before);
    // No staging or set-aside copy is left behind.
    expect(readdirSync(applications)).toEqual([MACOS_APP_NAME]);

    await createMacosWriter(applications).install({ ...paths(root, 'v2'), logDir: target.logDir });
    expect(readFileSync(executable, 'utf8')).not.toBe(before);
    expect(readdirSync(applications)).toEqual([MACOS_APP_NAME]);
  });

  it('removes only our bundle, and removing a missing one is fine', async () => {
    const root = tempDir();
    const shortcut = shortcutFor('darwin', root);
    await shortcut.add();
    const other = join(root, 'home', 'Applications', 'Other.app');
    mkdirSync(other);
    await shortcut.remove();
    expect(existsSync(join(root, 'home', 'Applications', MACOS_APP_NAME))).toBe(false);
    expect(existsSync(other)).toBe(true);
    await shortcut.remove();
    expect((await shortcut.status()).installed).toBe(false);
  });
});

/**
 * A stand-in for PowerShell and `WScript.Shell`: the create script writes a
 * placeholder file and keeps the fields it was given; the read script prints
 * them as the real one does (base64 of JSON).
 */
function fakePowerShell() {
  const links = new Map<string, LinkFields>();
  const calls: Array<{ script: string; env: Readonly<Record<string, string>> }> = [];
  const run: PowerShellRunner = async (script, env) => {
    calls.push({ script, env });
    const link = env[LINK_ENV.path]!;
    if (script === CREATE_LINK_SCRIPT) {
      writeFileSync(link, 'lnk');
      links.set(link, { targetPath: env[LINK_ENV.node]!, arguments: `"${env[LINK_ENV.bin]}"`, workingDirectory: env[LINK_ENV.workDir]!, description: LINK_DESCRIPTION });
      return '';
    }
    if (script === READ_LINK_SCRIPT) {
      const fields = links.get(link) ?? { targetPath: '', arguments: '', workingDirectory: '', description: '' };
      return `${Buffer.from(JSON.stringify(fields), 'utf8').toString('base64')}\r\n`;
    }
    throw new Error('unexpected script');
  };
  return { run, calls, links };
}

describe('Windows: Ogden Agents.lnk in the Start Menu', () => {
  it('runs Windows PowerShell by absolute path, reading the script from stdin', () => {
    expect(powerShellInvocation({ SystemRoot: 'D:\\Win\\' })).toEqual({
      file: 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
    });
    expect(powerShellInvocation({}).file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    // Each script is one line, so `-Command -` runs it as one statement.
    for (const script of [CREATE_LINK_SCRIPT, READ_LINK_SCRIPT]) expect(script.trimEnd()).not.toContain('\n');
  });

  it('writes the link with the fixed script and every path in environment variables, never in the script', async () => {
    const root = tempDir();
    const fake = fakePowerShell();
    const shortcut = shortcutFor('win32', root, { runPowerShell: fake.run });
    await shortcut.add();
    const creates = fake.calls.filter((call) => call.script === CREATE_LINK_SCRIPT);
    expect(creates).toHaveLength(1);
    const { env } = creates[0]!;
    const { launcherEntry, nodePath } = paths(root);
    expect(env[LINK_ENV.node]).toBe(nodePath);
    expect(env[LINK_ENV.bin]).toBe(launcherEntry);
    expect(env[LINK_ENV.path]!.split(/[\\/]/).slice(-3)).toEqual(['Start Menu', 'Programs', WINDOWS_LINK_NAME]);
    for (const call of fake.calls) for (const value of Object.values(call.env)) expect(call.script).not.toContain(value);
    expect(CREATE_LINK_SCRIPT).toContain('$link.WindowStyle = 7');
    expect(CREATE_LINK_SCRIPT).toContain(`$link.Description = '${LINK_DESCRIPTION}'`);
    expect((await shortcut.status()).installed).toBe(true);

    await shortcut.remove();
    expect((await shortcut.status()).installed).toBe(false);
    await shortcut.remove();
  });

  it('skips the rewrite when the link already points here, and re-points it when a path moved', async () => {
    const root = tempDir();
    const fake = fakePowerShell();
    await shortcutFor('win32', root, { runPowerShell: fake.run }).add();
    await shortcutFor('win32', root, { runPowerShell: fake.run }).add();
    const creates = () => fake.calls.filter((call) => call.script === CREATE_LINK_SCRIPT).length;
    expect(creates()).toBe(1);
    const moved = paths(root, 'v2');
    await shortcutFor('win32', root, { runPowerShell: fake.run, ...moved }).add();
    expect(creates()).toBe(2);
    expect([...fake.links.values()][0]).toMatchObject({ targetPath: moved.nodePath, arguments: `"${moved.launcherEntry}"` });
  });

  it("never replaces or removes a link of the same name that isn't ours", async () => {
    const root = tempDir();
    const fake = fakePowerShell();
    const link = join(root, 'home', 'Start Menu', 'Programs', WINDOWS_LINK_NAME);
    mkdirSync(join(root, 'home', 'Start Menu', 'Programs'), { recursive: true });
    writeFileSync(link, 'someone else');
    fake.links.set(link, { targetPath: 'C:\\Other\\other.exe', arguments: '', workingDirectory: '', description: 'Something else' });
    const shortcut = shortcutFor('win32', root, { runPowerShell: fake.run });
    expect((await shortcut.status()).installed).toBe(false);
    await expect(shortcut.add()).rejects.toThrow(/did not make/);
    await expect(shortcut.remove()).rejects.toBeInstanceOf(ShortcutRefusal);
    expect(readFileSync(link, 'utf8')).toBe('someone else');
    expect(fake.calls.some((call) => call.script === CREATE_LINK_SCRIPT)).toBe(false);
  });

  it('turns a PowerShell failure into plain words that name no path', async () => {
    const root = tempDir();
    const shortcut = shortcutFor('win32', root, {
      runPowerShell: async (_script, env) => {
        throw new Error(`Exception calling Save for ${env[LINK_ENV.path]}`);
      },
    });
    const error = (await shortcut.add().catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(ShortcutRefusal);
    expect(error.message).toBe("Ogden Agents couldn't add the app shortcut.");
    expect(error.message).not.toContain(root);
  });

  it.runIf(process.platform === 'win32')('writes a real .lnk in a temp folder that reads back with the pinned paths, minimized', async () => {
    const root = tempDir();
    const shortcut = createOsAppShortcut({ platform: 'win32', ...paths(root), stateDir: join(root, 'data'), homeDir: root, programsDir: join(root, 'Programs') });
    await shortcut.add();
    const link = join(root, 'Programs', WINDOWS_LINK_NAME);
    expect(existsSync(link)).toBe(true);
    const read = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '$l = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK); "$($l.TargetPath)|$($l.Arguments)|$($l.WindowStyle)"'],
      { env: { ...process.env, LINK: link }, encoding: 'utf8', windowsHide: true },
    ).trim();
    const { launcherEntry, nodePath } = paths(root);
    expect(read).toBe(`${nodePath}|"${launcherEntry}"|7`);
    // Read back through the adapter's own script: ours, and already pointing here.
    expect((await shortcut.status()).installed).toBe(true);
    await shortcut.add();
    await shortcut.remove();
    expect(existsSync(link)).toBe(false);
  });
});

describe('Linux: ogden-agents.desktop', () => {
  it('writes an application entry with no terminal and the escaped Exec', async () => {
    const root = tempDir();
    const shortcut = shortcutFor('linux', root);
    await shortcut.add();
    const file = join(root, 'home', 'xdg data', 'applications', DESKTOP_FILE_NAME);
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    expect(lines[0]).toBe('[Desktop Entry]');
    expect(lines).toContain('Type=Application');
    expect(lines).toContain('Terminal=false');
    const { launcherEntry, nodePath } = paths(root);
    expect(execArgs(lines.find((line) => line.startsWith('Exec='))!.slice('Exec='.length))).toEqual([nodePath, launcherEntry]);
    expect(text).toBe(desktopEntry({ nodePath, launcherEntry, logDir: '' }));
    expect(text).not.toMatch(/https?:|#c=|token/i);
    expect((await shortcut.status()).installed).toBe(true);
  });

  it.runIf(spawnSync('desktop-file-validate', ['--help']).error === undefined)('passes desktop-file-validate', async () => {
    const root = tempDir();
    await shortcutFor('linux', root).add();
    execFileSync('desktop-file-validate', [join(root, 'home', 'xdg data', 'applications', DESKTOP_FILE_NAME)]);
  });

  it('re-points in place, and never touches an entry of the same name that is not ours', async () => {
    const root = tempDir();
    await shortcutFor('linux', root).add();
    const moved = paths(root, 'v2');
    await shortcutFor('linux', root, moved).add();
    const file = join(root, 'home', 'xdg data', 'applications', DESKTOP_FILE_NAME);
    expect(execArgs(readFileSync(file, 'utf8').split('\n').find((line) => line.startsWith('Exec='))!.slice(5))).toEqual([moved.nodePath, moved.launcherEntry]);

    const foreign = '[Desktop Entry]\nType=Application\nName=Other\nExec=other\n';
    writeFileSync(file, foreign);
    const shortcut = shortcutFor('linux', root);
    expect((await shortcut.status()).installed).toBe(false);
    await expect(shortcut.add()).rejects.toBeInstanceOf(ShortcutRefusal);
    await expect(shortcut.remove()).rejects.toBeInstanceOf(ShortcutRefusal);
    expect(readFileSync(file, 'utf8')).toBe(foreign);
  });
});

describe('support and the offer', () => {
  it('is unsupported on another OS or without a launcher, and add refuses in plain words', async () => {
    const root = tempDir();
    for (const shortcut of [shortcutFor('freebsd', root), createOsAppShortcut({ platform: 'linux', launcherEntry: undefined, nodePath: 'node', stateDir: root, homeDir: root })]) {
      expect((await shortcut.status()).supported).toBe(false);
      await expect(shortcut.add()).rejects.toThrow(/can't be added on this computer/);
      await shortcut.remove();
    }
  });

  it('turns a failure to save the offer answer into plain words', async () => {
    const root = tempDir();
    // The data folder is a file: nothing can be written in it.
    writeFileSync(join(root, 'data'), '');
    const error = (await shortcutFor('linux', root).dismissOffer().catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(ShortcutRefusal);
    expect(error.message).not.toContain(root);
  });

  it('keeps the offer answer in the data folder', async () => {
    const root = tempDir();
    await shortcutFor('linux', root).dismissOffer();
    expect(JSON.parse(readFileSync(join(root, 'data', APP_SHORTCUT_STATE_FILE), 'utf8'))).toEqual({ offerDismissed: true });
    expect((await shortcutFor('linux', root).status()).offerDismissed).toBe(true);
  });
});
