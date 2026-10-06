/**
 * Install detection for pane launchers (epic 16, story 16.5; E16-R5, spike
 * 16.1 finding 9). It LOOKS: it finds a program on the user's PATH or at its
 * well known places, and runs it once with `--version` under the allowlisted
 * environment, no shell (a Windows `.cmd` shim goes through `cmd.exe`, which
 * Node requires), with a timeout. It never installs, never runs an installer
 * and never passes a credential. The path it finds is absolute, and a pane
 * starts exactly that file: a bare name does not start on Windows.
 *
 * A PATH entry that is not absolute is ignored, so nothing in the folder
 * Ogden runs in can stand in for a program.
 */
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, posix, win32 } from 'node:path';
import type { LauncherRefusal, PaneLaunchers } from '@ogden-agents/core';
import type { PaneDetection, PaneLauncher, PaneLauncherStatus } from '@ogden-agents/shared';
import { helperEnvironment, WINDOWS_FOLDERS } from '../child-env.js';

/** What detection needs of the computer; replaced in tests. */
export interface DetectSystem {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** Whether `path` is a file the user can run. */
  runnable(path: string): boolean;
  /** Runs `path --version` (`.cmd` through `cmd.exe`) and answers its first line, or why not. */
  probe(path: string, env: Record<string, string>): Promise<{ ok: true; version: string } | { ok: false }>;
}

const PROBE_TIMEOUT_MS = 5_000;

export const nodeDetectSystem: DetectSystem = {
  get platform() {
    return process.platform;
  },
  get env() {
    return process.env;
  },
  runnable(path) {
    try {
      if (!statSync(path).isFile()) return false;
      if (process.platform === 'win32') return true;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  probe(path, env) {
    return new Promise((resolve) => {
      const win = process.platform === 'win32';
      const shim = win && /\.(cmd|bat)$/i.test(path);
      // Node refuses to run a .cmd or .bat without a shell; a shim goes through cmd.exe with the whole command in one more pair of quotes.
      // A shim's path with a character cmd would read as its own is not run (a Windows file name has no quote, so this is depth, not a hole).
      if (shim && /["%^!\r\n]/.test(path)) {
        resolve({ ok: false });
        return;
      }
      const comspec = Object.entries(env).find(([key]) => key.toUpperCase() === 'COMSPEC')?.[1];
      const root = Object.entries(env).find(([key]) => key.toUpperCase() === 'SYSTEMROOT')?.[1] ?? 'C:\\Windows';
      const file = shim ? (comspec ?? win32.join(root, 'System32', 'cmd.exe')) : path;
      const args = shim ? ['/d', '/s', '/c', `""${path}" --version"`] : ['--version'];
      try {
        // Run away from any project: the program's own working folder is a neutral one.
        const child = execFile(file, args, { env, cwd: tmpdir(), timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL', windowsHide: true, windowsVerbatimArguments: shim, maxBuffer: 64 * 1024 }, (error, stdout) => {
          clearTimeout(hard);
          if (error) resolve({ ok: false });
          else resolve({ ok: true, version: String(stdout).trim().split(/\r?\n/, 1)[0]?.slice(0, 80) ?? '' });
        });
        // The program is never given input, and a grandchild that keeps the pipes open can't hold detection up past its time.
        child.stdin?.end();
        const hard = setTimeout(() => {
          child.kill('SIGKILL');
          resolve({ ok: false });
        }, PROBE_TIMEOUT_MS + 1_000);
        hard.unref();
      } catch {
        resolve({ ok: false });
      }
    });
  },
};

/** The environment of the version request: the allowlist, plus the Windows folders a shim needs. Never a key. */
function probeEnvironment(system: DetectSystem): Record<string, string> {
  return helperEnvironment(system.platform === 'win32' ? WINDOWS_FOLDERS : [], system.env, system.platform);
}

const platformKey = (platform: NodeJS.Platform): 'darwin' | 'linux' | 'win32' => (platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux');

/** An executable entry as the places to try: a bare name on each PATH folder (Windows: each PATHEXT), or one expanded absolute path. */
function candidatesFor(entry: string, system: DetectSystem): string[] {
  const win = system.platform === 'win32';
  const path = win ? win32 : posix;
  const env = system.env;
  const lookup = (name: string) => Object.entries(env).find(([key]) => (win ? key.toUpperCase() === name.toUpperCase() : key === name))?.[1];
  if (/^[A-Za-z0-9._-]+$/.test(entry)) {
    // Only absolute folders (on Windows with a drive letter: no network share and no folder relative to the current drive's root).
    const unquoted = (dir: string) => (win ? dir.replace(/^"(.*)"$/, '$1') : dir);
    const dirs = (lookup('PATH') ?? '').split(win ? ';' : delimiter).map(unquoted).filter((dir) => dir !== '' && (win ? /^[A-Za-z]:[\\/]/.test(dir) : path.isAbsolute(dir)));
    const exts = win ? (lookup('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => ext.toLowerCase()) : [''];
    return dirs.flatMap((dir) => exts.map((ext) => path.join(dir, `${entry}${ext}`)));
  }
  const home = win ? (lookup('USERPROFILE') ?? lookup('HOME')) : lookup('HOME');
  // A variable that is not set means the place is not known: no candidate, never a path at the drive root.
  let missing = false;
  const withHome = entry.startsWith('~') ? (home === undefined || home === '' ? ((missing = true), entry) : home + entry.slice(1)) : entry;
  const expanded = withHome.replace(/%([\w()]+)%/g, (_, name: string) => {
    const value = lookup(name);
    if (value === undefined || value === '') missing = true;
    return value ?? '';
  });
  return !missing && path.isAbsolute(expanded) && !expanded.includes('%') ? [expanded] : [];
}

export interface Detected extends PaneDetection {
  /** The absolute path found (never sent to the page). */
  path?: string;
}

/** What detection finds for one launcher. */
export async function detectLauncher(launcher: PaneLauncher, system: DetectSystem = nodeDetectSystem): Promise<Detected> {
  if (launcher.kind === 'shell') return { launcherId: launcher.id, state: 'found' };
  const env = probeEnvironment(system);
  const entries = launcher.executables[platformKey(system.platform)];
  // The first candidate that answers wins; one that is there but silent (a stale shim) does not hide a working one further on.
  let silent: string | undefined;
  for (const entry of entries) {
    for (const candidate of candidatesFor(entry, system)) {
      if (!system.runnable(candidate)) continue;
      const answer = await system.probe(candidate, env);
      if (answer.ok) return { launcherId: launcher.id, state: 'found', path: candidate, ...(answer.version === '' ? {} : { version: answer.version }) };
      silent ??= candidate;
    }
  }
  if (silent !== undefined) return { launcherId: launcher.id, state: 'failed', path: silent, reason: `${launcher.label} is installed but did not answer. Try running it in a terminal yourself.` };
  return { launcherId: launcher.id, state: 'not_found', reason: `${launcher.label} was not found on this computer. Install it yourself, then press Detect.` };
}

export interface PaneLaunchersOptions {
  launchers: readonly PaneLauncher[];
  system?: DetectSystem;
}

/** The launchers port over detection: looked up once, kept until Detect looks again. */
export function createPaneLaunchers({ launchers, system = nodeDetectSystem }: PaneLaunchersOptions): PaneLaunchers {
  let found: Promise<Map<string, Detected>> | undefined;
  const run = (): Promise<Map<string, Detected>> =>
    Promise.all(launchers.map((launcher) => detectLauncher(launcher, system))).then((all) => new Map(all.map((one) => [one.launcherId, one])));
  // One look at a time: a Detect pressed while another runs shares it; a look that failed is not kept.
  const results = () => {
    const current = (found ??= run());
    current.catch(() => {
      if (found === current) found = undefined;
    });
    return current;
  };
  const view = async (): Promise<PaneLauncherStatus[]> => {
    const map = await results();
    return launchers.flatMap((launcher) => {
      const { path: _path, ...detection } = map.get(launcher.id) ?? { launcherId: launcher.id, state: 'not_found' as const };
      // A launcher to show only when installed is left out while it is missing.
      return detection.state === 'not_found' && !launcher.showWhenMissing ? [] : [{ launcher, detection }];
    });
  };
  return {
    list: view,
    detect() {
      const current = (found = run());
      return current.then(() => view());
    },
    get: (launcherId) => launchers.find((launcher) => launcher.id === launcherId),
    async command(launcherId, args) {
      const launcher = launchers.find((candidate) => candidate.id === launcherId);
      if (launcher === undefined || launcher.kind === 'shell') return refusal('unknown_launcher', 'That program is not one Ogden Agents can start.');
      const detection = (await results()).get(launcherId);
      if (detection === undefined || detection.state === 'not_found' || detection.path === undefined) {
        return refusal('not_found', detection?.reason ?? `${launcher.label} was not found on this computer. Install it yourself, then press Detect.`);
      }
      if (detection.state === 'failed') return refusal('failed', detection.reason ?? `${launcher.label} did not answer.`);
      // On Windows an npm shim is a batch file: cmd.exe reads its command line, so a typed argument with a character cmd treats as its own is not passed.
      if (system.platform === 'win32' && /\.(cmd|bat)$/i.test(detection.path) && args.some((arg) => /[&|<>^%!"()\r\n]/.test(arg))) {
        return refusal('bad_args', `${launcher.label} is started through a Windows batch file, which can't take & | < > ^ % ! " or parentheses in its arguments. Take them out and try again.`);
      }
      // The absolute path found, the launcher's own plain arguments, then what the user typed. No credential, no flag of Ogden's own that skips a prompt.
      return { ok: true, file: detection.path, args: [...launcher.defaultArgs, ...args] };
    },
  };
}

const refusal = (code: LauncherRefusal['code'], reason: string): LauncherRefusal => ({ ok: false, code, reason });
