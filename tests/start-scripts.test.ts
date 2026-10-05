/**
 * The double-click start scripts in `start/`: `Start Ogden.command` (macOS),
 * `start-ogden.sh` (Linux) and `Start Ogden.cmd` (Windows). Each OS runs its
 * own script with a controlled PATH: the real Node in check mode, no Node,
 * a too-old fake Node, no npx, and a fake npx in place of the real launcher,
 * so nothing here installs anything, opens a browser or touches the network.
 * The full start of the packed tarball through each script is the smoke test
 * (`node scripts/smoke-installed.mjs --start-script <script>`, CI job
 * `start-scripts`).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const START = join(ROOT, 'start');
const MAC = join(START, 'Start Ogden.command');
const LINUX = join(START, 'start-ogden.sh');
const WINDOWS = join(START, 'Start Ogden.cmd');
const IS_WINDOWS = process.platform === 'win32';
const OWN_SCRIPT = IS_WINDOWS ? WINDOWS : process.platform === 'darwin' ? MAC : LINUX;
const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download';

const read = (file: string) => readFileSync(file, 'utf8');

/** The minimum Node.js major in package.json `engines` (`>=24`). */
function enginesMinimum(): number {
  const { engines } = JSON.parse(read(join(ROOT, 'package.json'))) as { engines: { node: string } };
  const match = /^>=(\d+)$/.exec(engines.node);
  if (match === null) throw new Error(`package.json engines.node is "${engines.node}", not ">=<major>"`);
  return Number(match[1]);
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** A temp folder whose path has a space, as a user's often does. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden start '));
  temps.push(dir);
  return dir;
}

/** A folder holding fake `node` (printing `version`) and, unless `npx` is false, a fake `npx` that prints its arguments and exits with `npxExit`. */
function fakeBin({ version, npx = true, npxExit = 0 }: { version: string; npx?: boolean; npxExit?: number }): string {
  const dir = join(tempDir(), 'bin');
  mkdirSync(dir);
  if (IS_WINDOWS) {
    writeFileSync(join(dir, 'node.cmd'), `@echo ${version}\r\n`);
    if (npx) writeFileSync(join(dir, 'npx.cmd'), `@echo ARGS: %*\r\n@echo DATA: %OGDEN_AGENTS_DATA_DIR%\r\n@exit /b ${npxExit}\r\n`);
  } else {
    writeFileSync(join(dir, 'node'), `#!/bin/sh\necho ${version}\n`);
    chmodSync(join(dir, 'node'), 0o755);
    if (npx) {
      writeFileSync(join(dir, 'npx'), `#!/bin/sh\nfor a in "$@"; do echo "ARG<$a>"; done\necho "DATA: $OGDEN_AGENTS_DATA_DIR"\nexit ${npxExit}\n`);
      chmodSync(join(dir, 'npx'), 0o755);
    }
  }
  return dir;
}

/** On Windows the system folder (the script calls `where` and `findstr` there by full path anyway); on POSIX nothing: the checks need only shell builtins, and `uname`, `open` and `xdg-open` are optional. */
const SYSTEM_PATH = IS_WINDOWS ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')] : [];

/**
 * Runs this OS's start script with `args`, a PATH of exactly `path` (or the
 * real one), never waiting for a key, stdin closed.
 */
function runScript(args: string[], { path, env = {}, cwd = tempDir() }: { path?: string[]; env?: Record<string, string>; cwd?: string } = {}): SpawnSyncReturns<string> {
  const base: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(path|ogden_agents_package|ogden_agents_data_dir|ogden_start_no_pause)$/i.test(key)),
  );
  const fullEnv = { ...base, PATH: path === undefined ? process.env.PATH : [...path, ...SYSTEM_PATH].join(IS_WINDOWS ? ';' : ':'), OGDEN_START_NO_PAUSE: '1', ...env };
  if (IS_WINDOWS) {
    // cmd.exe runs a batch file only through a shell; `/s` strips just the outer quotes.
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${WINDOWS}" ${args.join(' ')}"`], {
      cwd,
      env: fullEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  }
  // Executed as the file itself: its executable bit and shebang are part of the test.
  return spawnSync(OWN_SCRIPT, args, { cwd, env: fullEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const output = (result: SpawnSyncReturns<string>) => `${result.stdout}${result.stderr}`;

describe('start scripts: their files', () => {
  it('require the Node.js major version package.json engines names', () => {
    const minimum = enginesMinimum();
    expect(read(LINUX)).toContain(`MIN_NODE_MAJOR=${minimum}\n`);
    expect(read(WINDOWS)).toContain(`set "MIN_NODE_MAJOR=${minimum}"\r\n`);
  });

  it('macOS and Linux run the same script', () => {
    expect(read(MAC)).toBe(read(LINUX));
  });

  it('the Windows script has CRLF line endings throughout', () => {
    const text = read(WINDOWS);
    expect(text.split('\r\n').join('')).not.toContain('\n');
  });

  it.skipIf(IS_WINDOWS)('the macOS and Linux scripts are executable', () => {
    for (const script of [MAC, LINUX]) expect(statSync(script).mode & 0o111).toBe(0o111);
  });

  it('never escalate privileges, run PowerShell, or download and run a script', () => {
    for (const script of [LINUX, WINDOWS]) {
      // Comments say what the script never does; only the commands count.
      const commands = read(script)
        .split(/\r?\n/)
        .filter((line) => !/^\s*(#|rem\b)/i.test(line))
        .join('\n');
      for (const forbidden of [/\bsudo\b/, /\bsu\b/, /\bcurl\b/, /\bwget\b/, /powershell/i, /\brunas\b/i, /Invoke-/i, /\|\s*(ba)?sh\b/, /npm (i|install)\b/, /\bbrew\b/, /\bapt(-get)?\b/, /winget/i]) {
        expect(commands, `${script} matches ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });
});

describe(`start scripts: ${OWN_SCRIPT.slice(START.length + 1)} on this OS`, () => {
  it('--check with this Node reports it and the package, and exits 0', () => {
    const result = runScript(['--check']);
    expect(result.status, output(result)).toBe(0);
    expect(result.stdout).toContain(`Node.js: ${process.version}`);
    expect(result.stdout).toContain('Package: ogden-agents@latest');
    expect(result.stdout).toContain('Ready: Ogden Agents can start.');
  });

  it('--check names OGDEN_AGENTS_PACKAGE and OGDEN_AGENTS_DATA_DIR when set', () => {
    const data = join(tempDir(), 'my data');
    const result = runScript(['--check'], { env: { OGDEN_AGENTS_PACKAGE: 'ogden-agents@next', OGDEN_AGENTS_DATA_DIR: data } });
    expect(result.status, output(result)).toBe(0);
    expect(result.stdout).toContain('Package: ogden-agents@next');
    expect(result.stdout).toContain(`Data folder: ${data}`);
  });

  it('without Node: says so plainly, with the version needed and where to get it, and exits 1', () => {
    const result = runScript(['--check'], { path: [tempDir()] });
    expect(result.status, output(result)).toBe(1);
    expect(result.stdout).toMatch(/Node\.js is not installed/);
    expect(result.stdout).toContain(`Node.js ${enginesMinimum()} or later`);
    expect(result.stdout).toContain(NODE_DOWNLOAD_URL);
    expect(result.stdout).toContain('Nothing was installed or changed on your computer.');
    // Check mode opens nothing.
    expect(result.stdout).not.toContain('Opening the Node.js download page');
  });

  it('with a Node older than the minimum: names the version found and exits 1', () => {
    const result = runScript(['--check'], { path: [fakeBin({ version: 'v18.20.4' })] });
    expect(result.status, output(result)).toBe(1);
    expect(result.stdout).toContain('v18.20.4, which is too old');
    expect(result.stdout).toContain(`Node.js ${enginesMinimum()} or later`);
  });

  it('with a Node that reports no usable version: exits 1', () => {
    const result = runScript(['--check'], { path: [fakeBin({ version: 'garbage' })] });
    expect(result.status, output(result)).toBe(1);
    expect(result.stdout).toContain('did not report its version');
  });

  it('with Node but no npx: says to reinstall Node.js and exits 1', () => {
    const result = runScript(['--check'], { path: [fakeBin({ version: `v${enginesMinimum()}.0.0`, npx: false })] });
    expect(result.status, output(result)).toBe(1);
    expect(result.stdout).toContain('npx command is missing');
  });

  it.skipIf(IS_WINDOWS)('without Node, outside check mode: also opens the download page, and exits 1 without waiting when not in a terminal', () => {
    // An empty PATH: no `open` or `xdg-open` either, so no browser opens in the test.
    const result = runScript([], { path: [tempDir()], env: { OGDEN_START_NO_PAUSE: '' } });
    expect(result.status, output(result)).toBe(1);
    expect(result.stdout).toContain(`Opening the Node.js download page in your browser: ${NODE_DOWNLOAD_URL}`);
    expect(result.stdout).not.toContain('Press Return');
  });

  it('ignores a node or npx in the folder it is started from', () => {
    const cwd = tempDir();
    if (IS_WINDOWS) {
      writeFileSync(join(cwd, 'node.bat'), '@echo v99.0.0\r\n');
      writeFileSync(join(cwd, 'npx.bat'), '@echo PLANTED\r\n');
    } else {
      writeFileSync(join(cwd, 'node'), '#!/bin/sh\necho v99.0.0\n', { mode: 0o755 });
    }
    const result = runScript(['--check'], { cwd });
    expect(result.status, output(result)).toBe(0);
    expect(result.stdout).toContain(`Node.js: ${process.version}`);
    expect(result.stdout).not.toContain('PLANTED');
  });

  it.runIf(IS_WINDOWS)('refuses an argument that is not an --option, such as a dropped file, and runs nothing', () => {
    const result = runScript(['C:\\R^&D\\notes.txt'], { path: [fakeBin({ version: `v${enginesMinimum()}.1.0` })] });
    expect(result.status, output(result)).toBe(2);
    expect(result.stdout).toContain('takes only options that begin with --');
    expect(result.stdout).not.toContain('ARGS:');
  });

  it('--check prints a data folder with & in its name as text', () => {
    const data = join(tempDir(), 'R&D data');
    const result = runScript(['--check'], { env: { OGDEN_AGENTS_DATA_DIR: data } });
    expect(result.status, output(result)).toBe(0);
    expect(result.stdout).toContain(`Data folder: ${data}`);
  });

  it('runs npx with the package and passes arguments and the data folder through', () => {
    const data = join(tempDir(), 'my data');
    const tarball = join(tempDir(), 'ogden agents.tgz');
    const result = runScript(['--no-open', '--port', '0'], {
      path: [fakeBin({ version: `v${enginesMinimum()}.1.0` })],
      env: { OGDEN_AGENTS_PACKAGE: tarball, OGDEN_AGENTS_DATA_DIR: data },
    });
    expect(result.status, output(result)).toBe(0);
    if (IS_WINDOWS) {
      expect(result.stdout).toContain(`ARGS: --yes "--package=${tarball}" ogden --no-open --port 0`);
    } else {
      expect(result.stdout).toContain(['--yes', `--package=${tarball}`, 'ogden', '--no-open', '--port', '0'].map((arg) => `ARG<${arg}>`).join('\n'));
    }
    expect(result.stdout).toContain(`DATA: ${data}`);
  });

  it('without OGDEN_AGENTS_PACKAGE runs ogden-agents@latest', () => {
    const result = runScript([], { path: [fakeBin({ version: `v${enginesMinimum()}.1.0` })] });
    expect(result.status, output(result)).toBe(0);
    expect(result.stdout).toContain(IS_WINDOWS ? '"--package=ogden-agents@latest" ogden' : 'ARG<--package=ogden-agents@latest>');
  });

  it('when the launcher fails: says Ogden Agents did not start and exits with its code', () => {
    const result = runScript([], { path: [fakeBin({ version: `v${enginesMinimum()}.1.0`, npxExit: 7 })] });
    expect(result.status, output(result)).toBe(7);
    expect(result.stdout).toContain('Ogden Agents did not start (exit code 7)');
  });
});

// The scripts live in the repository and on GitHub Releases, never in the npm package.
it('start/ is not in the npm package', () => {
  const { files } = JSON.parse(read(join(ROOT, 'package.json'))) as { files: string[] };
  expect(files.some((entry) => entry.startsWith('start'))).toBe(false);
  expect(dirname(OWN_SCRIPT)).toBe(START);
});
